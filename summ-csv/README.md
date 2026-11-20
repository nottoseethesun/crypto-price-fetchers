# summ-csv

Summ, the crypto tax service, imports a csv file in its own layout, and
takes whatever the file says: a token named wrongly, an amount rounded, or
gas on two rows reaches the books as written. This utility, part of
crypto-price-fetchers, the owner's repo of code his projects share, writes
those files. It checks every row against the rules below and writes nothing while
any row breaks one, naming each problem and its row. Every csv for Summ is
made with it, by `npm run summ-csv` or from a Node program, rather than by
a script written for the occasion, so every file passes the same checks.

## Contents

- [The file it writes](#the-file-it-writes)
- [The rules](#the-rules)
- [Running it](#running-it)
  - [From the command line](#from-the-command-line)
  - [From Node](#from-node)
  - [From a project that installs this repo](#from-a-project-that-installs-this-repo)
- [The rows](#the-rows)
- [The settings](#the-settings)
  - [Adding a chain](#adding-a-chain)

## The file it writes

Summ reads a file by its header, which names sixteen columns: Summ's
fifteen standard ones and `Contract Address (Optional)`, which tells Summ
which token a row's currency is. The owner keeps that header in a template,
a file of one line, `advanced-template-reference.csv`; the utility reads the
template's first line and writes it as it is, padding included, since two
of its names start with a space. It refuses a template whose header lacks
one of the sixteen columns, names one twice, or names one Summ's import
does not have.

A line per row follows the header, with each line ended by a line feed, as
the template's is. Each value is written at the file's edge, from the form
a program holds it in:

- An amount as plain decimal text, such as `0.000000000000000001`, never in
  exponent form and never rounded.
- A time given in seconds since 1970 as Summ's `YYYY-MM-DD HH:MM:SS`, in
  UTC.
- On a chain whose hashes and addresses are hex, such as PulseChain, each
  hash and address in lower case, as the files Summ has already taken from
  the owner are written. A chain written in base58 keeps its case, since
  base58's `a` and `A` are different characters.
- A cell holding a comma, a quote or a line break in quotes, with each quote
  doubled, as csv files quote.

## The rules

Each rule refuses a row Summ would read wrongly, or one that breaks the
owner's rules for his files. A row breaks a rule when:

1. It is not an object, it holds a key that is no column's, or a column
   that holds text holds something else.
2. Its type is not one of the types Summ's custom import takes, as Summ's
   help article "Custom CSV import" lists them.
3. It leaves empty a column every row fills: Timestamp, Type, Base
   Currency, Base Amount, From or To. Summ needs the first four; the
   owner's files name both sides of every movement.
4. It fills Quote Currency or Quote Amount. A row carries one token, since
   Contract Address names one: a trade is a `sell` row and a `buy` row.
5. Its time is neither whole seconds since 1970 nor a real time written as
   `YYYY-MM-DD HH:MM:SS`.
6. An amount is a JavaScript number, which cannot hold every amount
   exactly, or is not a plain decimal above zero, or `{raw, decimals}` with
   `raw` above zero and `decimals` from 0 to 255.
7. It fills Fee Currency without Fee Amount, or the reverse, or, on a
   blockchain, puts gas in a coin other than the chain's own, which is
   what gas is paid in.
8. It names a blockchain the settings do not hold.
9. On a blockchain, it names no transaction hash in ID, or its ID, From,
   To or Contract Address does not have the chain's form: on PulseChain,
   `0x` and 64 hex digits for a hash, and `0x` and 40 for an address.
10. On a blockchain, its token has no Contract Address, or the chain's own
    coin, PLS on PulseChain, which has no contract, has one.
11. Its reference price is not a number or plain decimal above zero, it
    names a reference price currency without a price, or the currency is
    not one of the fiat currencies the settings list. Summ ignores a
    reference price in anything but fiat.
12. It carries a transaction's gas when an earlier row of the same
    transaction, on the same blockchain, already does, so the gas would be
    counted twice.

## Running it

The utility runs from the command line, with the rows in a JSON file, or
from a Node program, with the rows as objects. Either way it writes the
file only when every row passes, and leaves a file already at the path as
it is unless told to replace it.

### From the command line

From this repo's top folder:

```sh
npm run summ-csv -- --rows rows.json --template advanced-template-reference.csv --out missing-transactions.csv
```

It prints `Wrote 2 rows to missing-transactions.csv.`, with exit code 0, or
every problem, with exit code 1. `--replace` writes over a file already at
`--out`; `--help` gives the keys of a row.

### From Node

```js
import { writeSummCsv } from "crypto-price-fetchers/summ-csv";

writeSummCsv({
  rows,
  templatePath: "advanced-template-reference.csv",
  outPath: "missing-transactions.csv",
});
```

`writeSummCsv` returns `{rowCount, outPath}`. When a row breaks a rule, it
throws an error whose `problems` lists each problem with its row, counted
from 1, and whose message lists them too. `summCsvText(rows, header)` gives
the file's text without writing it, and `readTemplateHeader(path)` gives a
template's header.

### From a project that installs this repo

A project that installs this repo from GitHub imports
`crypto-price-fetchers/summ-csv`, as above, and has the bin `summ-csv`,
which a script in its `package.json` runs, such as
`"summ-csv": "summ-csv"`.

## The rows

A row is an object keyed by column. The command line reads a JSON array
of them; JSON has no BigInt, so an amount in the file is text.

| Key | Column | What it holds |
| --- | ------ | ------------- |
| `timestamp` | Timestamp (UTC) | Whole seconds since 1970, or Summ's `YYYY-MM-DD HH:MM:SS`, in UTC. |
| `type` | Type | One of Summ's types, such as `income`, `sell` or `remove-liquidity`. |
| `baseCurrency` | Base Currency | The row's token, by the symbol Summ knows it by. |
| `baseAmount` | Base Amount | Decimal text, such as `"12.5"`, or `{raw, decimals}`: the amount in the token's smallest units, as a BigInt or as digits, and the token's decimals. |
| `quoteCurrency`, `quoteAmount` | Quote Currency, Quote Amount | Left empty: a row carries one token. |
| `feeCurrency`, `feeAmount` | Fee Currency, Fee Amount | The gas, on one row of a transaction, in the chain's own coin. An amount, as `baseAmount`. |
| `from`, `to` | From, To | The two sides of the movement: on a blockchain, addresses. |
| `blockchain` | Blockchain | The chain, by Summ's name for it, such as `pulsechain`. |
| `id` | ID | On a blockchain, the transaction's hash. |
| `description` | Description | Free text. |
| `referencePrice` | Reference Price Per Unit | A number, or decimal text, above zero. |
| `referencePriceCurrency` | Reference Price Currency | A fiat currency the settings list; Summ takes USD when it is empty. |
| `contractAddress` | Contract Address | The token's contract; empty for the chain's own coin. |

An empty value, `null` or `""` leaves its cell empty.

## The settings

The rules for a row on a blockchain read that chain's facts from
`settings.json` beside this file, which ships with the package:

- `chains`: each chain by Summ's name for it, with `ownCoin`, the chain's
  own coin, and the forms of its `transactionHash` and `address`. A form
  names a `prefix`, an `alphabet` (`hex` or `base58`) and a `length`, or a
  `minLength` and a `maxLength`.
- `referencePriceCurrencies`: the fiat currencies a reference price may be
  in.

A program can pass settings of its own as `settings`.

### Adding a chain

A chain is added to `settings.json`, with no change to the code, under
Summ's name for it. A chain whose hashes and addresses are base58 names
the alphabet and the lengths its hashes and addresses take:

```json
{
  "chains": {
    "<Summ's name for the chain>": {
      "ownCoin": "<its own coin>",
      "transactionHash": {
        "prefix": "",
        "alphabet": "base58",
        "minLength": 86,
        "maxLength": 88
      },
      "address": {
        "prefix": "",
        "alphabet": "base58",
        "minLength": 32,
        "maxLength": 44
      }
    }
  }
}
```
