<!-- deno-fmt-ignore-file -->

Fedify: a fediverse server framework
====================================

[![JSR][JSR badge]][JSR]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]

Fedify is a [Deno]/TypeScript library for building federated server apps
powered by [ActivityPub] and other standards, which is so-called [fediverse].
You may already know some of the networks in the fediverse, such as [Mastodon],
[Lemmy], [Pixelfed], [PeerTube], and so on.  It aims to eliminate
the complexity and redundant boilerplate code when building a federated server
app, so that you can focus on your business logic and user experience.

Fedify is still in the early stage of development, and it's not ready
for production use yet.  However, you can try it out and give feedback
to help improve it.
The rough roadmap is to implement the following features out of the box:

 -  Type-safe objects for [Activity Vocabulary] (including some vendor-specific
    extensions)
 -  [WebFinger] client and server
 -  [HTTP Signatures]
 -  Middlewares for handling webhooks
 -  [ActivityPub] client
 -  Special touch for interoperability with Mastodon and few other popular
    fediverse software

If you want to know more about the project, please take a look at the following
resources:

 -  [JSR]
 -  [Manual](https://dahlia.github.io/fedify/manual/)
 -  [API reference](https://jsr.io/@fedify/fedify/doc)
 -  [Examples](https://github.com/dahlia/fedify/tree/main/examples)

[JSR]: https://jsr.io/@fedify/fedify
[JSR badge]: https://jsr-badge.deno.dev/@fedify/fedify/unstable.svg
[GitHub Actions]: https://github.com/dahlia/fedify/actions/workflows/build.yaml
[GitHub Actions badge]: https://github.com/dahlia/fedify/actions/workflows/build.yaml/badge.svg
[Deno]: https://deno.com/
[ActivityPub]: https://www.w3.org/TR/activitypub/
[fediverse]: https://en.wikipedia.org/wiki/Fediverse
[Mastodon]: https://joinmastodon.org/
[Lemmy]: https://join-lemmy.org/
[Pixelfed]: https://pixelfed.org/
[PeerTube]: https://joinpeertube.org/
[Activity Vocabulary]: https://www.w3.org/TR/activitystreams-vocabulary/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[HTTP Signatures]: https://tools.ietf.org/html/draft-cavage-http-signatures-12


Prerequisite
------------

[Deno] 1.41.0 or later with `--unstable-kv` flag
