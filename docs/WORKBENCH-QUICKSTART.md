# Your first flow and regression test

This exercise takes you from a fresh checkout to a flow you can inspect, break, export and fix. It runs entirely on your computer with synthetic stock and inputs. You need Node.js 22 or newer and npm; Node 22 and 24 are validated. You do not need Redis, Docker, credentials or a telecom account.

## 1. Start from the checkout

```sh
git clone https://github.com/anthonylimo90/USSD-State-Builder.git
cd USSD-State-Builder
npm ci
npm run workbench:onboarding
```

Open the printed URL, normally **http://127.0.0.1:3201/**. Keep this terminal running. The page creates the first session automatically. This starter is intentionally broken; the later steps repair it. `npm run workbench` opens the broader SDK/traditional demo instead.

All commands below run from the checkout root in a second terminal. If port 3201 is occupied, start with `PORT=3202 npm run workbench:onboarding` and open the printed URL. If a module or command is missing, check `node --version` and run `npm ci` in the checkout root. These workbench additions must be present in your checkout; installing the older published npm package alone does not provide this exercise.

## 2. Create your flow

Open `examples/workbench/onboarding/flow.js`. `createMachine()` builds the same application for the handset and replay; its storage, clock and inventory dependency come from arguments. There are no production clients.

Create a help path by replacing the existing `HOME` state line with:

```js
    .state('HOME', state => state.message('My demo shop\n1 Check stock\n2 Help')
      .on('1').goto('QUANTITY').on('2').goto('HELP'))
    .state('HELP', state => state.message('Local synthetic stock only.\n1 Return')
      .on('1').goto('HOME'))
```

Leave the `QUANTITY` state unchanged for now. Save the file, stop the server with **Ctrl+C**, run `npm run workbench:onboarding` again, and reload the page. Server modules load at startup; **Reset** alone does not load source edits.

## 3. Inspect a transition

Choose **Dial**, then reply `2`. The handset displays help, the inspector reads `HELP`, and turn history records `HOME → HELP`. In the graph's **All states and transitions · text view**, find `HOME: ... 2 → HELP` and `HELP: 1 → HOME`. Reply `1` to return to `HOME`.

The graph shows declared paths, while the inspector/history show actual execution. `QUANTITY` uses a dynamic handler, so its undeclared exits remain explicitly unknown. Zero structural errors does not prove the business code works. Choose **Reset** before the next step so the failing session has exactly three turns.

## 4. Reproduce the failure

Dial, reply `1`, then reply `3`. The fake inventory has only two units. The defective handler throws rather than allowing another quantity. The handset displays a safe failure message; the inspector remains in `QUANTITY` and turn 3's outcome is `error`. No reservation, payment or network request occurs.

Choose **Create replay draft**. The scenario has three `__REPLACE_INPUT_N__` placeholders and no captured dependency bodies. **Run isolated replay** refuses these placeholders. This is expected: traces never reconstruct the original inputs or external responses.

## 5. Export a failing regression

Open `examples/workbench/onboarding/scenario.json` and paste its entire JSON into **Synthetic scenario (JSON)**. It explicitly supplies the synthetic inputs `""`, `"1"`, `"3"`, the named fake `stock-two`, and the desired **successful retry in `QUANTITY`**. That expectation protects the fix, rather than accepting the observed error.

Choose **Run isolated replay**. It fails at **Turn 3** with an expectation mismatch. Choose **Generate Jest test**, then **Download Jest test**. Save the file as `tests/onboarding-stock-regression.test.js`; the factory path is relative to that location. Alternatively, copy the Jest preview into that file. If browser downloads are unavailable, generate exactly the same authored scenario from the terminal:

```sh
node examples/workbench/onboarding/server.js --export > tests/onboarding-stock-regression.test.js
npm test -- --runInBand --runTestsByPath tests/onboarding-stock-regression.test.js
```

Before generating, check that this filename does not already contain a test you need: the shell redirection replaces it. Jest should fail with `EXPECTATION_MISMATCH` on turn 3. The exported file runs without the browser or server; it imports your flow and author-created fakes directly. Keep this file unchanged while fixing the application.

## 6. Fix the flow

In `examples/workbench/onboarding/flow.js`, replace this line:

```js
        throw new Error('Teaching defect: insufficient stock should allow a retry');
```

with:

```js
        return 'CON Only 2 available. Try another quantity.';
```

Run the same Jest command again. The test now passes: three turns match the expected states and outcomes. To verify that it protects the repair, temporarily restore the throw and rerun it; it fails on turn 3 again. Restore the retry response afterward.

Restart the server, reload, dial and reply `1`, `3`. You now see the retry message in `QUANTITY`. Reply `2` to end with the synthetic reservation message. To check isolated replay, paste the same scenario and run it again: it passes while the handset's session and history remain unchanged. Do not add the reservation reply to the three-turn regression unless you also update the scenario's expected terminal state to `null`.

## Keyboard and small screens

Use **Tab** and **Shift+Tab** to move through controls. The first Tab reveals **Skip to session workspace**; Enter moves focus into the workspace. Reply supports Enter for both Dial and Send. Buttons support Enter/Space. The graph is focusable and scrolls with arrow keys, and its text view works without visual interpretation of the diagram. Both text-view disclosures support Enter/Space. Expanded Jest source is separately focusable and scrollable. Invalid scenario JSON is described next to the editor and moves focus back there; asynchronous action buttons retain keyboard focus after completion.

At narrow widths, sessions, handset, inspector and replay stack vertically, and action buttons wrap. The graph scrolls independently rather than widening the page. Browser checks cover 320px and 390px widths, keyboard focus, labels, replay errors, and both disclosures; this is scoped validation, not a full screen-reader or WCAG certification.

## Continue with your application

Use the [local workbench guide](LOCAL-WORKBENCH.md) to register more SDK or traditional flow factories, and the [replay guide](REPLAY-AND-TEST-EXPORT.md) for clocks, dependency scripts and export references. Keep all handset/replay dependencies synthetic. Replay factories are trusted application code, not a security sandbox: hooks and imported clients must also use local fakes. Only explicitly public scalar fields appear in the inspector; structural history omits inputs, responses and exception text. The handset itself displays application responses, so keep sensitive real data out of this exercise.

When finished, stop the server with Ctrl+C. Your source edits and exported test remain normal checkout changes. On an **unedited starter checkout**, `npm run test:onboarding` validates the shipped walkthrough automatically without modifying your working files. It installs a disposable checkout, adds the help route, verifies the declared and executed path, exports the test, confirms failure, applies the documented one-line fix, and confirms success. Run that gate before editing the starter; after your own edits, use the exported regression test and `npm test` to validate your application instead.
