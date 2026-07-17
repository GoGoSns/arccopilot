# Release Smoke Test Checklist

Run this checklist before shipping a release build.

| Step | Expected result |
| --- | --- |
| 1. Open the popup and let Wallet load. | The Wallet screen renders and the USDC balance loads from Arc RPC without a crash. |
| 2. Open Daily Brief. | The greeting appears, suggestions render, and Recent Activity is populated from Blockscout when data exists. |
| 3. Check Arc on X. | Both the official section and the community section load tweets from TwitterAPI.io. |
| 4. Inspect tweet cards. | AI category badges appear on tweets when the selected provider has a key. |
| 5. Open Gogo AI and interact with it. | The proactive greeting appears, balance questions are answered, memory persists, multi-step actions are returned, tweet drafts are generated, address risk analysis works, and spending summaries are produced. |
| 6. Create a reminder and return to Morning Brief. | The reminder is saved and later appears in the Morning Brief or Daily Brief reminder area. |
| 7. Open Settings. | The AI provider switches without erasing saved provider keys, API keys are masked, key links are correct, language switching works, custom search and official account fields save correctly, and notification toggles persist. |
| 8. Test failure cases. | Missing keys degrade gracefully, invalid addresses are rejected, and the UI shows a clear error or empty state instead of breaking. |

Pass criteria:

- No blank popup
- No uncaught runtime error in the UI
- No blocked action without a user-facing explanation
- No version mismatch between the app chrome and the release metadata
