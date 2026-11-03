# Third-party notices

## Files in this repository based on third-party code

| Our file | Based on | Licence |
|---|---|---|
| `makecode/sim/sim.css` (the blocks marked `[MIT]`: touch/selection rules and label colours of the on-screen controls) | `microsoft/pxt-arcade` `share/src/css/GameButtons.css` and `share/src/css/Joystick.css` at commit `2d7d59b5226e8a1a1e05e8042dd9f5248ed68fea` (tag v4.2.1) | MIT, Copyright (c) Microsoft Corporation |
| `makecode/sim/simulator.html` (the two SVG controls: d-pad/joystick and A/B buttons) | `microsoft/pxt-arcade` `share/src/components/Joystick.tsx` and `share/src/components/GameButtons.tsx` at the same commit | MIT, Copyright (c) Microsoft Corporation |

The rest of `sim.css` and `simulator.html` is our own. MakeCode's hosted simulator stylesheet
(`cdn.makecode.com/.../sim.css`) is not published under an open licence and is not used or copied.

## Third-party code in the release artefact (not in this repository)

The build (`makecode/build.sh`) packages Microsoft MakeCode Arcade into `kids-code-lab-<version>.tar.gz`:
`microsoft/pxt-arcade` (tag v4.2.1, including the compiled simulator `built/sim.js` from the npm package
`pxt-arcade@4.2.1`), `pxt-core` 13.2.1 and `pxt-common-packages` 14.1.4, all MIT, Copyright (c) Microsoft
Corporation, together with the third-party packages they bundle (their notices ship inside those packages).
The Greek translations are the approved MakeCode Crowdin translations, downloaded at build time.
MakeCode, Microsoft and their logos are trademarks of Microsoft; this project is not affiliated with Microsoft.

## MIT License (microsoft/pxt-arcade)

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```
