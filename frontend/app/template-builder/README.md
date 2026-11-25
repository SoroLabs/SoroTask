# Template Builder ABI Import

The template builder now accepts a Soroban contract ABI and turns each exported function into a configurable action card.

## How to use it

1. Open the template builder at /template-builder.
2. Paste a contract ABI JSON (array of functions or an object with a functions array) into the Import Custom ABI panel.
3. Enter the contract address and optional label.
4. Click Import. Each function becomes a custom action in the Custom tab.
5. Drop the generated action onto the canvas and fill out the generated form fields.

## Supported parameter types

The form generator understands common Soroban-like parameter types, including:

- address
- numeric types such as u32, u64, i128
- bool (rendered as a select)
- string and bytes

The builder validates required values before a template can be saved.
