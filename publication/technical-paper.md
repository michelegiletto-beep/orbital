Orbital Mission Simulation Hub
Configurable training scenarios for orbital proximity and disposal
Michele Giletto
Technical report prepared 17 October 2026

Abstract

Orbital combines scenario authoring, numerical execution and assessment in a local web application. Its intended use is engineering training and procedure exploration with synthetic spacecraft. The advanced workspace propagates multiple Earth centered inertial states with central gravity, an optional J2 contribution, an engineering drag approximation, impulsive maneuvers and finite thrust with propellant accounting. Docking and passive recovery use relative measurements between propagated vehicles. Deorbiting terminates at a descending atmospheric interface. Client specific scenario revisions bind initial conditions, vehicle properties, approach criteria and learning objectives to the result of an exercise. This report describes the model, software architecture, verification approach and limits of inference. It does not present independent flight dynamics validation, measured learning gains or evidence of commercial adoption.

Purpose and context

The work addresses a practical authoring problem: an instructor should be able to change an exercise, execute it and review its outcome without separating the scenario definition from the command history and final assessment. The principal output is a reproducible record of a bounded training activity.

Orbital activity, disposal and servicing provide a relevant domain for these exercises. ESA's 2026 environment report describes growing traffic and continuing disposal needs [1]. Its commercialisation material identifies servicing and debris removal as developing service areas [2]. These observations motivate the subject matter. They do not establish demand for this application, a market share, or a quantified benefit to a purchaser.

The application is deliberately scoped to training. Real proximity operations require navigation, sensing, contact dynamics, vehicle specific actuation and extensive verification. NASA's description of rendezvous and docking capabilities includes such disciplines [3]. Orbital's simplified models do not substitute for them.

Software architecture

A strict TypeScript kernel is shared by the React application and the Node service. Sharing code reduces the risk that browser preview and server reconstruction silently implement different equations. It does not guarantee identical floating point behavior on every platform, and cross platform bit identity has not been established.

The application includes mission control, flight dynamics, the scenario library, a client editor and after action review. Three.js renders local Earth imagery and enlarged spacecraft markers. The display is an aid to interpretation; spacecraft visual size and rendered illumination are not physical measurements. No remote imagery service is needed for the bundled view.

The API accepts validated commands and archives rather than trusting a browser supplied final grade. Restoration replays canonical initial conditions and the command journal. Resource authorization, scenario identity and signed receipts must remain bound throughout storage, retrieval and result creation. The security design is intended to make specified tampering detectable. It does not make storage immutable against an administrator who controls the signing key and the files.

Client collections are editorial groupings within a tenant. They are not by themselves an organizational security boundary. Production isolation depends on authenticated tenant identity, authorization policy and the recipient deployment. Public demonstrations use synthetic collections only.

Numerical state and force model

The advanced state uses Earth centered inertial Cartesian position in kilometers, velocity in kilometers per second, mass in kilograms and elapsed time in seconds. The inertial Z axis points north. Scenario relative distances and velocity controls are exposed in meters and meters per second. Boundary conversions are explicit.

The acceleration is the sum of central gravity, the selected J2 contribution, engineering drag and commanded thrust. The gravitational parameter is 398600.4418 cubic kilometers per square second. J2 is 0.00108262668 with an equatorial reference radius of 6378.137 km. Reported altitude uses a spherical mean radius of 6371 km. The distinction is retained rather than treating those radii as interchangeable [4].

Fourth order Runge Kutta integrates the state. The generic workspace accepts a bounded maximum step. Maneuver starts, cutoffs and propellant depletion split steps so that a scheduled boundary is not rounded to the next output sample. Integration convergence and boundary tests assess this implementation. They do not bound all errors caused by model simplification.

Drag uses a static representative density table, logarithmic interpolation, a co rotating spherical atmosphere, constant area and a constant drag coefficient. It is an engineering sensitivity model, not a full implementation of the US Standard Atmosphere or a space weather service [5]. Solar activity, winds, variable area and density uncertainty are not modeled. Extrapolating this approximation to lifetime prediction would require a separate validation effort.

For finite thrust, acceleration follows the commanded direction and current mass. Mass flow is thrust divided by specific impulse and standard gravity. An impulsive maneuver uses the rocket equation. Dry mass bounds available propellant. The ideal actuator model omits thruster lag, minimum impulse bit, plume interaction, navigation error and actuator fault behavior unless explicitly represented by a scenario parameter.

Relative state and proximity exercises

The advanced proximity workflow propagates a target and a chaser in the shared nonlinear inertial engine. A local radial, along track and orbit normal frame is derived from the target state. Relative position is the inertial separation projected into that frame. Relative velocity accounts for the rotating frame in guidance and assessment. Reference frame definition is essential in rendezvous modeling [6].

Initial relative position and velocity, spacecraft masses, specific impulse, drag properties, maneuver authority and budget are scenario inputs. An approach is divided into ordered hold points and a final capture region. A successful capture requires explicit acceptance of the configured distance, relative speed and attitude conditions. Crossing the position threshold alone is not sufficient evidence of docking.

The recovery exercise includes target rotation and bounded chaser roll tracking through a disclosed scalar model. Synchronization evolves over simulated time and is assessed against the configured angle and rate limits; a command does not instantly stabilize the passive target. This allows an instructor to vary the alignment task and acceptance limits. It is not six degree of freedom rigid body dynamics. Capture is a logical mission event; latches, flexible structures, contact forces, rebound, sensor occlusion and physical grappling are outside the model. A successful exercise does not establish a validated capture mechanism.

The original library also retains educational linear relative motion exercises. Results must identify the selected executor and model so that a linear exercise is not confused with a nonlinear advanced run. A family label alone does not convey model fidelity.

Deorbit exercise boundary

Deorbiting targets a lower perigee through an impulsive or finite maneuver. The exercise assesses maneuver expenditure and the resulting descent to the configured atmospheric boundary. The model terminates at the descending 120 km interface. The event time is localized within the numerical procedure and recorded with the session.

This interface is a modeling boundary. Orbital does not propagate atmospheric flight, heating, fragmentation, aerodynamic lift, debris survival, terrain contact or ground casualty risk. No ground impact point, population exposure or regulatory disposal compliance may be inferred from an interface event. Predicting those quantities requires different models and validation data.

Scenario identity and instructional evidence

Each client scenario has a versioned definition. The run retains its initial conditions, vehicle properties, mission constraints and assessment thresholds. Later edits create a new revision and do not relabel or reinterpret the recorded run.

Objectives describe observable checks. Examples are reaching hold points in sequence, remaining within propellant budget, meeting capture speed and alignment limits, and reaching the atmospheric interface after a disposal maneuver. Guided execution supports demonstration and practice. The final assessment and replay support discussion of decisions and deviations. A score represents the implemented checks, not a validated measure of operator competence.

Arbitrary text objectives cannot create a new scientific grading model. Where an instructor changes objective wording, the associated numerical criterion must remain explicit. Claims about improved learning require a study with learners, a baseline, a defined outcome and appropriate analysis. No such study is reported here.

Verification and reproducibility

The final verification run on 17 October 2026 passed 68 automatic tests, with no failures, cancellations, skipped tests or pending tests, on Windows with Node 22.13.1. Strict web TypeScript checking, the production bundle and API TypeScript compilation passed. The locked dependency audit reported zero known vulnerabilities across 160 dependency entries at the time checked. An earlier cold API fixture startup timeout was corrected and retained in the release record before the successful full rerun. These are measured implementation checks within the stated environment.

The verification approach separates equations, mission logic, persistence and user workflow. Analytical circular orbit closure and energy conservation examine central gravity integration. J2 nodal drift is compared with a first order secular reference. Finite burn mass consumption is checked against the rocket equation. Step refinement, maneuver boundary timing, dry mass cutoff and drag energy change test additional numerical behavior.

Advanced mission kernel regressions cover the four catalog docking and recovery scenarios, both catalog deorbit scenarios with two burn modes, rotating frame conversion, edited customer parameters, rejected unsafe capture, ordered hold points, exhausted budget, abort, between sample collision detection, objective binding and malformed journal rejection. The custom case uses an 800 kg chaser, 650 kg dry mass, an initial 180 m along track separation, a 0.015 m per second initial relative velocity, hold points at 80 m, 12 m and 0.2 m, a 0.4 m capture distance and a 0.03 m per second speed limit. It completes at 0.222791 m separation and 0.002347 m per second relative speed after 336 seconds, with 7.195066 m per second accumulated maneuver expenditure. These values are measured synthetic implementation outputs.

Archive replay is compared with the complete computed session from canonical initial conditions and recorded commands. Modified journal timestamps, reversed commands, unsupported fields and invalid limits are rejected. HTTP checks execute authoritative creation, commands, reports and restoration. Concurrent commands with a stale sequence receive HTTP 409. Persistence regressions reject modified authorization metadata, rollback to an older signed record, mismatched result labels and deletion that conflicts with the audit record. These checks address the actual storage and result provenance boundaries.

The measured synthetic cases were regenerated on 17 October 2026 and are recorded in model-evidence.json. They can be reproduced by measure-release.ts. Nine cases complete and reproduce exactly through journal replay on Node 22.13.1 on Windows. The evidence includes final relative distance and speed, elapsed simulation time, maneuver expenditure, remaining mass, perigee and interface time. All four disposal runs reach the descending 120 km interface. The 600 km disposal case reaches it at 2229.086351 seconds with an impulsive burn and at 2329.384141 seconds with an 800 N finite burn. Figures produced by this implementation are not external reference truth. The versioned release verification record also identifies the full test result, environment, package inspection and browser evidence. Numerical tolerances in a regression define its pass condition; they are not a global accuracy guarantee.

NASA's modeling standard distinguishes the credibility evidence required for a model's intended use [7]. The tests described here are implementation verification. An independent benchmark campaign, empirical validation against relevant vehicle behavior and a formal accreditation process have not been completed. Citation of a standard does not assert conformance to it.

Delivery and security boundaries

The offline delivery contains the application, selected synthetic library, local assets, notices, a component inventory and integrity metadata. SHA256 file digests and a signed manifest detect changes relative to the signed content. The recipient must establish trust in the public key through a separate trusted channel. A public key bundled beside a modified package does not establish issuer identity.

The server supports federated identity integration and application authorization, but production readiness depends on the connected identity provider, TLS, key custody, network configuration, encrypted storage, backup and external audit anchoring. No FIPS validated module, smart card integration, government accreditation or immutable storage qualification is claimed by the source code alone.

Original source and documentation remain proprietary to Michele Giletto. The software license grants 30 days of internal nonoperational evaluation, including local execution and scenario creation, without registration or external activation. Redistribution, paid instruction, production deployment and operational flight use are excluded. Public inspection does not make the project open source. Third party components retain their own licenses. Customer records, signing keys, tokens and identity settings are excluded from public artifacts.

Commercial evaluation

The supported commercial hypothesis is a customer who needs configurable technical exercises and repeatable review. A bounded evaluation should compare the effort required to prepare one scenario, execute it, reconstruct the run and assess the result with the current process. Dedicated scenario libraries, deployment integration and ongoing support are possible scopes to test with that customer.

This report contains no validated pricing, revenue projection, customer reference, willingness to pay or quantified time saving. Domain activity supports the relevance of the subject, while buyer interviews and an observed evaluation are needed to establish product usefulness and procurement fit.

Availability and status

This report describes version 0.3.0 as an engineering evaluation release. The accompanying source, measured case evidence and verification record define the inspected implementation. No public DOI is assigned in this locally prepared report. No customer evaluation, operational flight qualification or independent physical validation is reported.

References

[1] European Space Agency. ESA Space Environment Report 2026. September 2026. https://www.esa.int/Space_Safety/Space_Debris/ESA_Space_Environment_Report_2026

[2] European Space Agency Commercialisation Gateway. In space services. Consulted 16 October 2026. https://commercialisation.esa.int/industries/in-space-services/

[3] NASA Johnson Space Center. Rendezvous, Proximity Operations and Docking Subsystems. Consulted 16 October 2026. https://www.nasa.gov/reference/jsc-rendezvous-prox-ops-docking-subsystems/

[4] Roithmayr, Carlos M., and Speth, Paul W. Analysis of Opportunities for Intercalibration between Two Spacecraft. 2010. Section 2 discusses spherical geometry and the J2 secular node rate. NASA NTRS record 20120007107. https://ntrs.nasa.gov/api/citations/20120007107/downloads/20120007107.pdf

[5] United States Standard Atmosphere, 1976. NTRS record 19770009539. https://ntrs.nasa.gov/citations/19770009539

[6] Henderson, David M. Reference equations of motion for automatic rendezvous and capture. NASA CR 185676. April 1992. https://ntrs.nasa.gov/citations/19930020463

[7] NASA. Standard for Models and Simulations. NASA STD 7009, Revision B, 2024. https://standards.nasa.gov/standard/NASA/NASA-STD-7009

© 2026 Michele Giletto. All rights reserved. Referenced organizations do not endorse this software.
