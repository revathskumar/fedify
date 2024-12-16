import { toPascalCase } from "@std/text/to-pascal-case";
import metadata from "../deno.json" with { type: "json" };
import { getFieldName } from "./field.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";
import { areAllScalarTypes, getTypeNames } from "./type.ts";

function emitOverride(
  typeUri: string,
  types: Record<string, TypeSchema>,
  property: PropertySchema,
): string {
  const type = types[typeUri];
  let supertypeUri = type.extends;
  while (supertypeUri != null) {
    const st = types[supertypeUri];
    if (st.properties.find((p) => p.singularName === property.singularName)) {
      return "override";
    }
    supertypeUri = st.extends;
  }
  return "";
}

async function* generateProperty(
  type: TypeSchema,
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const override = emitOverride(type.uri, types, property);
  const doc = `\n/** ${property.description.replaceAll("\n", "\n * ")}\n */\n`;
  if (areAllScalarTypes(property.range, types)) {
    if (property.functional || property.singularAccessor) {
      yield doc;
      yield `${override} get ${property.singularName}(): (${
        getTypeNames(property.range, types)
      } | null) {
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        return this.${await getFieldName(property.uri)}[0];
      }
      `;
    }
    if (!property.functional) {
      yield doc;
      yield `get ${property.pluralName}(): (${
        getTypeNames(property.range, types, true)
      })[] {
        return this.${await getFieldName(property.uri)};
      }
      `;
    }
  } else {
    yield `
    async #fetch${toPascalCase(property.singularName)}(
      url: URL,
      options: {
        documentLoader?: DocumentLoader,
        contextLoader?: DocumentLoader,
        suppressError?: boolean,
        tracerProvider?: TracerProvider,
      } = {}
    ): Promise<${getTypeNames(property.range, types)} | null> {
      const documentLoader =
        options.documentLoader ?? this._documentLoader ?? getDocumentLoader();
      const contextLoader =
        options.contextLoader ?? this._contextLoader ?? getDocumentLoader();
      const tracerProvider = options.tracerProvider ??
        this._tracerProvider ?? trace.getTracerProvider();
      const tracer = tracerProvider.getTracer(
        ${JSON.stringify(metadata.name)},
        ${JSON.stringify(metadata.version)},
      );
      return await tracer.startActiveSpan("activitypub.lookup_object", async (span) => {
        let fetchResult: RemoteDocument;
        try {
          fetchResult = await documentLoader(url.href);
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          span.end();
          if (options.suppressError) {
            getLogger(["fedify", "vocab"]).error(
              "Failed to fetch {url}: {error}",
              { error, url: url.href }
            );
            return null;
          }
          throw error;
        }
        const { document } = fetchResult;
        try {
          const obj = await this.#${property.singularName}_fromJsonLd(
            document,
            { documentLoader, contextLoader, tracerProvider }
          );
          span.setAttribute("activitypub.object.id", (obj.id ?? url).href);
          span.setAttribute(
            "activitypub.object.type",
            // @ts-ignore: obj.constructor always has a typeId.
            obj.constructor.typeId.href
          );
          return obj;
        } catch (e) {
          if (options.suppressError) {
            getLogger(["fedify", "vocab"]).error(
              "Failed to parse {url}: {error}",
              { error: e, url: url.href }
            );
            return null;
          }
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(e),
          });
          throw e;
        } finally {
          span.end();
        }
      });
    }

    async #${property.singularName}_fromJsonLd(
      jsonLd: unknown,
      options: {
        documentLoader?: DocumentLoader,
        contextLoader?: DocumentLoader,
        tracerProvider?: TracerProvider,
      }
    ): Promise<${getTypeNames(property.range, types)}> {
      const documentLoader =
        options.documentLoader ?? this._documentLoader ?? getDocumentLoader();
      const contextLoader =
        options.contextLoader ?? this._contextLoader ?? getDocumentLoader();
      const tracerProvider = options.tracerProvider ??
        this._tracerProvider ?? trace.getTracerProvider();
    `;
    for (const range of property.range) {
      if (!(range in types)) continue;
      const rangeType = types[range];
      yield `
        try {
          return await ${rangeType.name}.fromJsonLd(
            jsonLd,
            { documentLoader, contextLoader, tracerProvider },
          );
        } catch (e) {
          if (!(e instanceof TypeError)) throw e;
        }
      `;
    }
    yield `
      throw new TypeError("Expected an object of any type of: " +
        ${JSON.stringify(property.range)}.join(", "));
    }

    `;
    if (property.functional || property.singularAccessor) {
      yield `
      /**
       * Similar to
       * {@link ${type.name}.get${toPascalCase(property.singularName)}},
       * but returns its \`@id\` URL instead of the object itself.
       */
      ${override} get ${property.singularName}Id(): URL | null {
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        const v = this.${await getFieldName(property.uri)}[0];
        if (v instanceof URL) return v;
        return v.id;
      }
      `;
      yield doc;
      yield `
      ${override} async get${toPascalCase(property.singularName)}(
        options: {
          documentLoader?: DocumentLoader,
          contextLoader?: DocumentLoader,
          suppressError?: boolean,
          tracerProvider?: TracerProvider,
        } = {}
      ): Promise<${getTypeNames(property.range, types)} | null> {
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        const v = this.${await getFieldName(property.uri)}[0];
        if (v instanceof URL) {
          const fetched =
            await this.#fetch${toPascalCase(property.singularName)}(v, options);
          if (fetched == null) return null;
          this.${await getFieldName(property.uri)}[0] = fetched;
          return fetched;
        }
      `;
      if (property.compactName != null) {
        yield `
        if (
          this._cachedJsonLd != null &&
          typeof this._cachedJsonLd === "object" &&
          "@context" in this._cachedJsonLd &&
          ${JSON.stringify(property.compactName)} in this._cachedJsonLd
        ) {
          const prop = this._cachedJsonLd[
            ${JSON.stringify(property.compactName)}];
          const obj = Array.isArray(prop) ? prop[0] : prop;
          if (obj != null && typeof obj === "object" && "@context" in obj) {
            return await this.#${property.singularName}_fromJsonLd(obj, options);
          }
        }
        `;
      }
      yield `
        return v;
      }
      `;
    }
    if (!property.functional) {
      yield `
      /**
       * Similar to
       * {@link ${type.name}.get${toPascalCase(property.pluralName)}},
       * but returns their \`@id\`s instead of the objects themselves.
       */
      ${override} get ${property.singularName}Ids(): URL[] {
        return this.${await getFieldName(property.uri)}.map((v) =>
          v instanceof URL ? v : v.id!
        ).filter(id => id !== null);
      }
      `;
      yield doc;
      yield `
      ${override} async* get${toPascalCase(property.pluralName)}(
        options: {
          documentLoader?: DocumentLoader,
          contextLoader?: DocumentLoader,
          suppressError?: boolean,
          tracerProvider?: TracerProvider,
        } = {}
      ): AsyncIterable<${getTypeNames(property.range, types)}> {
        const vs = this.${await getFieldName(property.uri)};
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          if (v instanceof URL) {
            const fetched =
              await this.#fetch${toPascalCase(property.singularName)}(
                v, options);
            if (fetched == null) continue;
            vs[i] = fetched;
            yield fetched;
            continue;
          }
      `;
      if (property.compactName != null) {
        yield `
          if (
            this._cachedJsonLd != null &&
            typeof this._cachedJsonLd === "object" &&
            "@context" in this._cachedJsonLd &&
            ${JSON.stringify(property.compactName)} in this._cachedJsonLd
          ) {
            const prop = this._cachedJsonLd[
              ${JSON.stringify(property.compactName)}];
            const obj = Array.isArray(prop) ? prop[i] : prop;
            if (obj != null && typeof obj === "object" && "@context" in obj) {
              yield await this.#${property.singularName}_fromJsonLd(obj, options);
              continue;
            }
          }
        `;
      }
      yield `
          yield v;
        }
      }
      `;
    }
  }
}

export async function* generateProperties(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  for (const property of type.properties) {
    yield* generateProperty(type, property, types);
  }
}
