# Third-party notices

This file records third-party software included in Fluently distributions. Dependency versions are pinned in the workspace manifests and lockfile.

## fflate 0.8.3

- Package: `fflate`
- Version: `0.8.3`
- Source: https://github.com/101arrowz/fflate
- Package license: MIT
- Used by: `packages/storage-web/src/curriculum-zip.ts` for bounded ZIP archive inspection and DEFLATE extraction, and `services/api/src/curriculum-package.ts` for ZIP32 curriculum archive creation.

MIT License

Copyright (c) 2026 Arjun Barrett

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
SOFTWARE.

The upstream fflate README also records a special exemption for SheetJS and
allows SheetJS to license source code from fflate under the BSD Zero Clause
License. Fluently does not rely on that exemption and retains the MIT notice
above.
