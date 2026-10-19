Orbital 0.3.0 is an engineering evaluation release for orbital mission training with synthetic spacecraft. It includes editable client scenarios, finite and impulsive deorbit burns, docking, passive target recovery, command replay and recorded assessment.

[Project and screenshots](https://giletto-systems-lab.michele-giletto.chatgpt.site/projects/orbital)

[Browser evaluation](https://giletto-systems-lab.michele-giletto.chatgpt.site/orbital/)

[Offline application package](https://github.com/michelegiletto-beep/orbital/blob/2331cb3537844c940309e2b06841bd51fa90cb82/distribution/Orbital.zip)

[Technical report](https://github.com/michelegiletto-beep/orbital/blob/2331cb3537844c940309e2b06841bd51fa90cb82/publication/Orbital-technical-report.pdf)

[Verification workflow](https://github.com/michelegiletto-beep/orbital/actions/runs/39204112333) passed the test suite, strict TypeScript checks, production build, SBOM generation and dependency audit. Source and distribution objects were compared with the prepared file hashes. The application package is unchanged from the verified offline build.

Application SHA256: `0ad542f98c8eaa49c4be67f30b1f6ffb128473c4e9ad2493efc12b5defd2b151`

Report SHA256: `4895925a6e14fc68361145c404c4093294acefd073fd257b326a08fde77fae15`

The source includes locally bundled historical Earth imagery and third party notices. The orbital model uses numerical propagation, optional J2 and an engineering drag approximation. Recovery attitude is scalar. Deorbit propagation stops at the descending 120 km interface and excludes atmospheric entry and ground impact.

Original software remains proprietary to Michele Giletto. LICENSE and EVALUATION.md permit thirty days of internal evaluation and local scenario creation. Redistribution, paid instruction, commercial deployment and operational flight use require separate permission. This release does not include trained mission agents or assert flight qualification.

© 2026 Michele Giletto.
