# Task Payload & Argument Constraints

To maintain the performance and security of the SoroTask Keeper network, all incoming task payloads and arguments are subject to strict validation rules. If a task exceeds these limits, it will be rejected early in the ingestion lifecycle to prevent wasted resources.

## 1. Global Payload Limits

| Constraint             | Limit               | Description                                                                             |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| **Max Payload Size**   | `8 KB (8192 bytes)` | The absolute maximum size of the serialized `taskConfig` and `args` combined.           |
| **Data Serialization** | `Valid JSON`        | Payloads must be fully JSON-serializable. Circular references are immediately rejected. |

## 2. Task Configuration (`taskConfig`)

| Field          | Type     | Validation Rules                                                                                          |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `target`       | `String` | Must be a valid Soroban Contract Address. Exactly **56 characters** and must begin with the letter **C**. |
| `functionName` | `String` | The name of the contract function to invoke. Cannot exceed **64 characters**.                             |

## 3. Execution Arguments (`args`)

| Constraint        | Limit             | Description                                                                                                |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **Type**          | `Array`           | Arguments must always be passed as an array, even if empty (`[]`).                                         |
| **Max Arguments** | `20 items`        | A single task execution cannot contain more than 20 distinct arguments.                                    |
| **String Length** | `1024 characters` | Individual string arguments must not exceed 1024 characters to prevent stack exhaustion during simulation. |

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
