import { getLogger } from "@logtape/logtape";
import type { DocumentLoader } from "../runtime/docloader.ts";
import { signRequest } from "../sig/http.ts";
import { validateCryptoKey } from "../sig/key.ts";
import { signJsonLd } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import type { Recipient } from "../vocab/actor.ts";
import type { Activity } from "../vocab/mod.ts";

/**
 * Parameters for {@link extractInboxes}.
 */
export interface ExtractInboxesParameters {
  /**
   * Actors to extract the inboxes from.
   */
  recipients: Recipient[];

  /**
   * Whether to prefer the shared inbox over the personal inbox.
   * Defaults to `false`.
   */
  preferSharedInbox?: boolean;

  /**
   * The base URIs to exclude from the recipients' inboxes.  It is useful
   * for excluding the recipients having the same shared inbox with the sender.
   *
   * Note that the only `origin` parts of the `URL`s are compared.
   *
   * @since 0.9.0
   */
  excludeBaseUris?: URL[];
}

/**
 * Extracts the inbox URLs from recipients.
 * @param parameters The parameters to extract the inboxes.
 *                   See also {@link ExtractInboxesParameters}.
 * @returns The inboxes as a map of inbox URL to actor URIs.
 */
export function extractInboxes(
  { recipients, preferSharedInbox, excludeBaseUris }: ExtractInboxesParameters,
): Record<string, Set<string>> {
  const inboxes: Record<string, Set<string>> = {};
  for (const recipient of recipients) {
    const inbox = preferSharedInbox
      ? recipient.endpoints?.sharedInbox ?? recipient.inboxId
      : recipient.inboxId;
    if (inbox != null && recipient.id != null) {
      if (
        excludeBaseUris != null &&
        excludeBaseUris.some((u) => u.origin == inbox.origin)
      ) {
        continue;
      }
      inboxes[inbox.href] ??= new Set();
      inboxes[inbox.href].add(recipient.id.href);
    }
  }
  return inboxes;
}

/**
 * A key pair for an actor who sends an activity.
 * @since 0.10.0
 */
export interface SenderKeyPair {
  /**
   * The actor's private key to sign the request.
   */
  privateKey: CryptoKey;

  /**
   * The public key ID that corresponds to the private key.
   */
  keyId: URL;
}

/**
 * Parameters for {@link sendActivity}.
 */
export interface SendActivityParameters {
  /**
   * The activity to send.
   */
  activity: Activity;

  /**
   * The key pairs of the sender to sign the request.  It must not be empty.
   * @since 0.10.0
   */
  keys: SenderKeyPair[];

  /**
   * The inbox URL to send the activity to.
   */
  inbox: URL;

  /**
   * The context loader to use for JSON-LD context retrieval.
   * @since 0.8.0
   */
  contextLoader?: DocumentLoader;

  /**
   * The document loader for loading remote JSON-LD documents.
   * @since 0.10.0
   */
  documentLoader?: DocumentLoader;

  /**
   * Additional headers to include in the request.
   */
  headers?: Headers;
}

/**
 * Sends an {@link Activity} to an inbox.
 *
 * @param parameters The parameters for sending the activity.
 *                   See also {@link SendActivityParameters}.
 * @throws {Error} If the activity fails to send.
 */
export async function sendActivity(
  {
    activity,
    keys,
    inbox,
    contextLoader,
    documentLoader,
    headers,
  }: SendActivityParameters,
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  if (activity.id == null) {
    throw new TypeError("The activity to send must have an id.");
  }
  if (activity.actorId == null) {
    throw new TypeError(
      "The activity to send must have at least one actor property.",
    );
  } else if (keys.length < 1) {
    throw new TypeError("The keys must not be empty.");
  }
  const activityId = activity.id.href;
  let proofCreated = false;
  let rsaKey: { keyId: URL; privateKey: CryptoKey } | null = null;
  for (const { keyId, privateKey } of keys) {
    validateCryptoKey(privateKey, "private");
    if (rsaKey == null && privateKey.algorithm.name === "RSASSA-PKCS1-v1_5") {
      rsaKey = { keyId, privateKey };
      continue;
    }
    if (privateKey.algorithm.name === "Ed25519") {
      activity = await signObject(activity, privateKey, keyId, {
        documentLoader,
        contextLoader,
      });
      proofCreated = true;
    }
  }
  let jsonLd = await activity.toJsonLd({
    format: "compact",
    contextLoader,
  });
  if (rsaKey == null) {
    logger.warn(
      "No supported key found to create a Linked Data signature for " +
        "the activity {activityId}.  The activity will be sent without " +
        "a Linked Data signature.  In order to create a Linked Data " +
        "signature, at least one RSASSA-PKCS1-v1_5 key must be provided.",
      {
        activityId,
        keys: keys.map((pair) => ({
          keyId: pair.keyId.href,
          privateKey: pair.privateKey,
        })),
      },
    );
  } else {
    jsonLd = await signJsonLd(jsonLd, rsaKey.privateKey, rsaKey.keyId, {
      contextLoader,
    });
  }
  if (!proofCreated) {
    logger.warn(
      "No supported key found to create a proof for the activity {activityId}.  " +
        "The activity will be sent without a proof.  " +
        "In order to create a proof, at least one Ed25519 key must be provided.",
      {
        activityId,
        keys: keys.map((pair) => ({
          keyId: pair.keyId.href,
          privateKey: pair.privateKey,
        })),
      },
    );
  }
  headers = new Headers(headers);
  headers.set("Content-Type", "application/activity+json");
  let request = new Request(inbox, {
    method: "POST",
    headers,
    body: JSON.stringify(jsonLd),
  });
  if (rsaKey == null) {
    logger.warn(
      "No supported key found to sign the request to {inbox}.  " +
        "The request will be sent without a signature.  " +
        "In order to sign the request, at least one RSASSA-PKCS1-v1_5 key " +
        "must be provided.",
      {
        inbox: inbox.href,
        keys: keys.map((pair) => ({
          keyId: pair.keyId.href,
          privateKey: pair.privateKey,
        })),
      },
    );
  } else {
    request = await signRequest(request, rsaKey.privateKey, rsaKey.keyId);
  }
  const response = await fetch(request);
  if (!response.ok) {
    let error;
    try {
      error = await response.text();
    } catch (_) {
      error = "";
    }
    logger.error(
      "Failed to send activity {activityId} to {inbox} ({status} " +
        "{statusText}):\n{error}",
      {
        activityId,
        inbox: inbox.href,
        status: response.status,
        statusText: response.statusText,
        error,
      },
    );
    throw new Error(
      `Failed to send activity ${activityId} to ${inbox.href} ` +
        `(${response.status} ${response.statusText}):\n${error}`,
    );
  }
}
