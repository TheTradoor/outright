# Website synchronization, 15 November 2026

Outright website version 32 was published successfully from Site source
`8d586c55f27b835a414a0746ff73e5c35a79fccb`. It mirrors all 79 canonical protocol
files from client revision `0f5558683c5128375c173c40085b17c9690d3b90`.
Engine and program pins are unchanged.

The homepage now links to Project updates. Documentation adds keeper health and
hosting, Pyth feed inspection, and the latest Hybrid funding results and release
checklist. Source links use the reviewed client revision.

## Verification

- Build, 20 HTML routes, 990 local links/assets and search anchors passed.
- Four price-illustration tests and 594 client tests passed, with no failures,
  skips or cancellations.
- All 79 canonical file hashes match the copied source.
- Chromium checks covered the desktop homepage and Updates, search navigation
  to the oracle guide, and mobile menus reaching Updates and the keeper guide.
- Responsive frames at 320 and 390 pixels had no horizontal document overflow
  on the reviewed home, Updates and terminal layouts.
- The terminal showed Market not open with wallet and trade review disabled.
- The published homepage and Updates page were opened after deployment.

[Publication record](site-publication.json), [source hashes](source-snapshot.json),
[test log](site-check.log), [published Updates screenshot](published-updates.jpg)
and [responsive review screenshot](responsive-review.jpg) are retained.
The local upload archive contains 39 files and excludes the temporary review page.
Its digests and the saved version's separate storage metadata are recorded;
byte equality between those archives is not asserted.

The linked protocol CI results were not rerun for this website-only update.
Responsive frames are not physical-device acceptance. Observed console errors
came from browser-extension metadata messages. No production wallet or live
market was configured. Owner-only access and the null deployment profile remain.

The native deployment reported success at 14:28 WIB on 15 November 2026.
The website is available at https://outright.bollish-eth.chatgpt.site and the
published update at https://outright.bollish-eth.chatgpt.site/docs/updates/.
