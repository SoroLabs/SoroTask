# Task Payload & Argument Constraints

To maintain the performance and security of the SoroTask Keeper network, all incoming task payloads and arguments are subject to strict validation rules. If a task exceeds these limits, it will be rejected early in the ingestion lifecycle to prevent wasted resources.

## 1. Global Payload Limits

| Constraint             | Limit               | Description                                                                             |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| **Max Payload Size**   | `8 KB (8192 bytes)` | The absolute maximum size of the serialized `taskConfig` and `args` combined.           |
| **Data Serialization** | `Valid JSON`        | Payloads must be fully JSON-serializable. Circular references are immediately rejected. |
| **Max Nesting Depth**  | `8 levels`          | Deeply nested arrays or objects are rejected before simulation or submission.           |

## 2. Task Configuration (`taskConfig`)

| Field          | Type     | Validation Rules                                                                                          |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `target`       | `String` | Must be a valid Soroban Contract Address. Exactly **56 characters** and must begin with the letter **C**. |
| `functionName` | `String` | The contract function to invoke. It must be a valid identifier and cannot exceed **64 characters**.       |

## 3. Execution Arguments (`args`)

| Constraint        | Limit             | Description                                                                                                |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **Type**          | `Array`           | Arguments must always be passed as an array, even if empty (`[]`).                                         |
| **Max Arguments** | `20 items`        | A single task execution cannot contain more than 20 distinct arguments.                                    |
| **String Length** | `1024 characters` | Individual string arguments must not exceed 1024 characters to prevent stack exhaustion during simulation. |
| **Object Width**  | `50 keys`         | Individual object arguments cannot contain more than 50 keys at one level.                                |

Unsupported argument values such as `bigint`, functions, and symbols are rejected because they do not round-trip through JSON consistently. Callers should convert large numeric values to strings before submission.

## Failure Contract

Backend callers can use `assertValidTaskPayload(taskConfig, args)` from `keeper/src/taskPayloadValidator.js` to fail fast with a `TaskPayloadValidationError`. The error has:

- `code`: `TASK_PAYLOAD_INVALID`
- `errors`: ordered validation messages suitable for API responses or logs

## Example Valid Payload

```json
{
  "taskConfig": {
    "target": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "functionName": "harvest_yield"
  },
  "args": [1000, "XLM"]
}
```
