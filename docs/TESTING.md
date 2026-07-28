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
| 7. Run `demo mode` in Gogo. | A local menu lists the available demo helper commands without requiring Gemini or a backend call. |
| 8. Run `demo status` in Gogo. | A local proof summary appears without requiring Gemini or a backend call, including Render + Neon + cron, the x402 payment id, and the scheduled-payment transaction hash. |
| 9. Run `demo links` in Gogo. | A local link pack appears with frontend/backend repos, Render backend, x402 payment id, and ArcScan proof link. |
| 10. Run `demo checklist` in Gogo. | A local pre-recording reliability checklist appears without requiring Gemini or a backend call. |
| 11. Run `demo script` in Gogo. | A local compact judging/screen-recording narration appears without requiring Gemini or a backend call. |
| 12. Run `x402 demo` in Gogo. | The quote displays 0.001 USDC on Arc Testnet, no signature is requested before the user taps **Pay & access**, and the paid response opens after approval. |
| 13. Run `create a reminder to pay 0.001 USDC to 0xB87B6D1a56bB7942bd07b6B0e9540a63b3dA4365 every 1 hour`. | Gogo creates a scheduled autonomous payment without requiring an AI provider response. The schedule appears in Settings with status Active. |
| 14. Check scheduled payment history after the first due time. | The schedule run is recorded as `complete` and links to an ArcScan transaction. |
| 15. Open Settings. | The AI provider switches without erasing saved provider keys, API keys are masked, key links are correct, language switching works, custom search and official account fields save correctly, and notification toggles persist. |
| 16. Test failure cases. | Missing keys degrade gracefully, invalid addresses are rejected, stale Railway backend URLs migrate to the Render backend, and the UI shows a clear error or empty state instead of breaking. |

Pass criteria:

- No blank popup
- No uncaught runtime error in the UI
- No blocked action without a user-facing explanation
- No version mismatch between the app chrome and the release metadata
