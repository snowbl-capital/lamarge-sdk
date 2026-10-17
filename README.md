# @lamarge/sdk

The TypeScript client of the [LaMarge API](https://docs.lamarge.trade): sign-in, transfers, takes and market making, with every signature checked before it is asked for. MIT.

```sh
npm install @lamarge/sdk
```

The package and its documentation are in [sdk/](sdk/README.md). This repository mirrors each release from LaMarge's repository, where the SDK is developed next to the server and the API's contract: `docs/api/api-reference/openapi.yaml` is that contract's public part, `server/src/lighter_sig/vectors.json` the Lighter vectors the checks are tested against. Changes are made upstream; issues are welcome here.
