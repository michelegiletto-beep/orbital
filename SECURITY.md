Orbital security information

Orbital is an engineering training application. It has no operational flight authorization or government accreditation. Its model and deployment assumptions are documented in docs/security.md and docs/flight-dynamics.md.

Version 0.3.0 is the current engineering evaluation line. Security corrections are provided through versioned releases. No support duration, response time or production service level is promised by this notice. Older versions should be compared against the current changelog and verification evidence before evaluation.

Reporting

If the public repository enables GitHub private vulnerability reporting, use its Report a vulnerability action. If that action is unavailable, obtain a private contact route from Michele Giletto through the account that distributed the software. No unverified email address or reporting endpoint is supplied here. Do not publish exploit details, credentials, customer records, private keys or unredacted audit data in a public issue.

A useful report identifies the exact version and source revision, installation mode, minimum reproduction steps, the affected trust boundary and expected versus actual behavior. Use synthetic data and remove tokens and secrets from examples. Preserve a reproduction archive only when it can be shared safely through the agreed private channel.

Deployment responsibilities

Local development binds to loopback and uses a development identity. A production deployment requires the institutional identity provider, HTTPS termination, provisioned signing key, storage permissions, backup, retention and network policy. The included templates are not proof of an exercised institutional deployment.

The audit chain and signed manifests provide integrity evidence relative to trusted keys. They are not immutable against an administrator who controls both the files and the keys. External anchoring and approved key custody are required where the deployment needs stronger guarantees. A bundled public key alone does not establish issuer trust.

The source inventory and locked dependencies should be scanned for every release. A zero finding dependency scan describes the tools and advisory data used at that time; it is not a warranty that the software has no vulnerabilities.

Public artifacts must exclude working customer libraries, saved sessions, environment configuration, identity tokens and private audit keys. The default demonstration content is synthetic. See the publication control record for the release inspection steps.
