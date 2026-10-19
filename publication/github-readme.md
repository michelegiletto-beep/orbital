Orbital Mission Simulation Hub

Version 0.3.0 is an engineering evaluation release.

Orbital is an engineering training application for configuring orbital exercises, executing maneuvers and reviewing the evidence from each run. It combines a dark English workspace, a mission library, customer scenario authoring and reproducible assessment records.

The intended use is technical instruction and procedure exploration with synthetic spacecraft. Original code remains proprietary to Michele Giletto. EVALUATION.md grants 30 days of internal nonoperational evaluation, including running the application and creating local scenario variants. No registration or activation service is required. Redistribution, paid instruction, production deployment and commercial reuse are outside that permission. Third party components retain their own licenses.

What the application does

Mission control supports multiple spacecraft, scheduled impulsive and finite maneuvers, J2 gravity, engineering atmospheric drag, numerical forecasts and ground tracks. The proximity and disposal workflows bring docking, passive recovery and deorbiting into the advanced numerical workspace. The scenario editor binds vehicle properties, initial relative conditions, ordered hold points, capture limits, recovery rotation, maneuver budget and assessment criteria to a versioned client definition.

The library includes transfer, docking, recovery, deorbiting, inspection and separation exercises. Customer collections can contain independent copies of templates. A saved result retains the scenario definition used for the run. Replay reconstructs the event sequence, while the assessment reports the relevant distances, speeds, expenditure and objective checks.

The API validates commands and reconstructs archived state. Server records use signatures and chained audit receipts. These mechanisms make specified changes detectable; they are not a substitute for independent key custody, external audit anchoring or a formally accredited deployment.

Run locally

Use Node 22.13 or later. Install from the lockfile in the product directory.

```powershell
npm ci --ignore-scripts
npm run dev
```

Start the local API in a second terminal.

```powershell
npm run api
```

The browser listens at http://127.0.0.1:4317 and the API at http://127.0.0.1:4318. Local development uses a loopback only identity. An institutional deployment requires the identity, key custody, network and storage configuration described in the administrator and security documentation.

Verify and package

```powershell
npm run verify
npm run sbom
npm audit --audit-level=moderate
npm run package
```

The offline package includes local Earth imagery, third party notices, file digests, a manifest signature, a verifier and a launcher. Verify the extracted package with `node verify.mjs`, establish trust in the public key separately, then run `node launch.mjs`. Customer deliveries must contain only the intended synthetic or approved client collection. Generated private keys, identity configuration, working sessions and customer data do not belong in a public release.

Model scope

The advanced engine integrates Cartesian Earth centered inertial state with fourth order Runge Kutta. The force model includes central gravity, an optional J2 term and a static engineering drag approximation. Maneuvers account for finite thrust, mass flow and dry mass cutoff. Proximity control is measured in a local orbital frame against physically propagated vehicles. The disclosed attitude model is scalar and is not a full rigid body simulation. Atmospheric propagation ends at the descending 120 km interface; heating, fragmentation, terrain, landing and ground casualty risk are excluded.

The analytical checks, regression suite, browser exercises and package inspection support the documented implementation behavior. They do not constitute independent physical validation, operational flight qualification, government accreditation or proof of learning outcomes. The release evidence must be read together with the model assumptions. No real spacecraft are commanded.

Commercial evaluation

A suitable first evaluation is one bounded training exercise using a customer's own acceptance criteria. Compare the preparation effort, reproducibility of the run and usefulness of the final review against the current process. Customer scenario adaptation, dedicated libraries and deployment integration are potential paid scopes. No customer adoption, willingness to pay or quantified economic benefit is asserted.

Documentation

Read the flight dynamics, library, instructional design, user, administrator, security and verification documents in the docs directory. The publication directory contains the technical report, release evidence requirements and citation preparation files.

© 2026 Michele Giletto. All rights reserved.
