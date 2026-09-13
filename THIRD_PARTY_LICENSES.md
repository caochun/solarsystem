# Third-party notices

The web application uses the following runtime libraries. Their notices are reproduced below. Development tools and optional asset import packages retain their own licenses in the packages installed by npm or pip.

OpenSpace-derived application code follows [LICENSE.md](LICENSE.md). Textures, 3D models and astronomical catalogs retain their original providers’ terms and credits; source URLs and provenance are documented in [DATA_SOURCES.md](DATA_SOURCES.md). This notice does not relicense those resources as application code.

## Three.js

https://github.com/mrdoob/three.js — installed version 0.186.0

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Astronomy Engine

https://github.com/cosinekitty/astronomy — installed version 2.1.19

MIT License

Copyright (c) 2019-2023 Don Cross <cosinekitty@gmail.com>

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

## NASA lunar maps, elevation and spacecraft reference images

Lunar source: https://svs.gsfc.nasa.gov/4720/ — credit **NASA's Scientific Visualization Studio; LRO / LROC / LOLA; Ernie Wright**. Color/elevation derivatives retain the source mapping and limitations. Full provenance and processing are recorded in `src/lunar-surface-data.json` and `DATA_SOURCES.md`.

Spacecraft images are redistributed as the original NASA library JPEGs, with each original credit, caption and source link retained in `src/surface-references.json` and displayed beside the reference image. Credits include NASA/JPL; NASA/JPL/Space Science Institute; and NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute. NASA imagery usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/ . These resources are not relicensed under the application's code license; no NASA endorsement is implied.

NAIF leap-seconds kernel `scripts/reference/naif0012.tls` is copied unchanged from OpenSpace `tests/horizonsTest/naif0012.tls`. Source: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls . Original explanatory text and modification history are preserved.
