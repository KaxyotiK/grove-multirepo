# Data model: Full scenario traceability

## Scenario

- `id`: globally unique §11 ID such as `TREE-04`
- `family`: prefix before the numeric suffix
- `setup`: authoritative preconditions
- `expectedResult`: authoritative observable result
- `sourceRow`: location in the §11 contract

Validation: IDs are unique and well formed; setup/result are reachable and constitutionally consistent.

## Witness

- `scenarioId`: exact authoritative ID in the test title
- `testFile`: executable `*.test.ts` source
- `layer`: module, CLI, or E2E
- `assertions`: checks proving the expected result

A witness is creditable only when its setup exercises the scenario and its assertions prove the result. Multiple scenarios may share a test only when each result is independently asserted.

## Deferral

- `scenarioId`
- `reason`
- `owner`: feature/task that removes it

Deferrals are temporary rollout state. Unknown, already-cited, ownerless, or final-state deferrals are invalid.

## Family gate

- `family`
- `scenarioCount`
- `witnessedCount`
- `deferredCount`
- `enabled`

State transition: `audited -> witnessed -> enabled`. An enabled family cannot regress to an uncited or invalid state. Final closure requires every discovered family enabled and zero deferrals.
