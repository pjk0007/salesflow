/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const fs = require("node:fs");
const { build } = require("esbuild");

function filesIn(directory, relative = "") {
  return fs.readdirSync(path.join(directory, relative)).sort().flatMap(name => {
    const child = path.join(relative, name);
    const info = fs.statSync(path.join(directory, child));
    return info.isDirectory() ? filesIn(directory, child) : [{ path: child.split(path.sep).join("/"), bytes: info.size }];
  });
}

function resolvedPackageRoot(name, from) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    // tslib exports its runtime entry but intentionally hides package.json.
    // Resolve that exact dependency, then identify its own package root.
    let directory = path.dirname(require.resolve(name, { paths: [from] }));
    for (let step = 0; step < 8; step++) {
      const candidate = path.join(directory, "package.json");
      if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, "utf8")).name === name) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`${name} 공식 설치 패키지 경로를 확인할 수 없습니다.`);
  }
}

function writeWorkerLicenses(runtime) {
  const pdfLibRoot = path.dirname(require.resolve("pdf-lib/package.json"));
  const notices = ["Third-party licenses for the bundled Sendb electronic-signature PDF worker."];
  const packages = [];
  for (const name of ["pdf-lib", "@pdf-lib/standard-fonts", "@pdf-lib/upng", "pako", "tslib"]) {
    const directory = resolvedPackageRoot(name, pdfLibRoot);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    if (metadata.name !== name || typeof metadata.version !== "string") throw new Error(`${name} 패키지 정보를 확인할 수 없습니다.`);
    const files = fs.readdirSync(directory).sort().filter(file => /^(?:licen[cs]e|copyrightnotice|notice)(?:[._-]|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
    if (!files.some(file => /^licen[cs]e(?:[._-]|$)/i.test(file))) throw new Error(`${name} 라이선스 파일이 없어 PDF 처리기 배포를 준비할 수 없습니다.`);
    for (const file of files) {
      const original = fs.readFileSync(path.join(directory, file), "utf8");
      if (!original.trim()) throw new Error(`${name} ${file} 라이선스가 비어 있습니다.`);
      notices.push(`Package: ${name}\nVersion: ${metadata.version}\nSource file: ${file}\n\n${original}`);
    }
    packages.push({ name, version: metadata.version, files });
  }
  const target = path.join(runtime, "pdf-worker-LICENSES.txt");
  fs.writeFileSync(target, notices.join("\n\n----------------------------------------\n\n") + "\n");
  return { packages, bytes: fs.statSync(target).size };
}

async function main() {
  const runtime = path.join(__dirname, "../.esign-runtime");
  const worker = path.join(runtime, "pdf-worker.cjs");
  await build({
    entryPoints: [path.join(__dirname, "../src/lib/esign/pdf-worker-entry.ts")],
    outfile: worker,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    minify: true,
    sourcemap: false,
    legalComments: "inline",
    logLevel: "warning",
  });

  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (metadata.name !== "pdfjs-dist" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version)) {
    throw new Error("공식 PDF.js 패키지 버전을 확인할 수 없습니다.");
  }
  const destination = path.join(runtime, "pdfjs-assets", metadata.version);
  fs.mkdirSync(destination, { recursive: true });
  const directories = {};
  for (const name of ["cmaps", "standard_fonts", "wasm"]) {
    const source = path.join(packageRoot, name);
    const files = filesIn(source);
    if (!files.length) throw new Error(`PDF.js ${name} 자료가 없습니다.`);
    fs.cpSync(source, path.join(destination, name), { recursive: true, dereference: true });
    directories[name] = { fileCount: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0), files };
  }
  fs.copyFileSync(path.join(packageRoot, "LICENSE"), path.join(destination, "LICENSE"));
  const licenseBytes = fs.statSync(path.join(destination, "LICENSE")).size;
  const fileCount = Object.values(directories).reduce((total, directory) => total + directory.fileCount, 0) + 1;
  const bytes = Object.values(directories).reduce((total, directory) => total + directory.bytes, 0) + licenseBytes;
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({
    package: metadata.name, version: metadata.version, license: metadata.license,
    licenseFile: "LICENSE", licenseBytes, directories, fileCount, bytes,
    source: "installed official pdfjs-dist package; no external product assets",
  }, null, 2) + "\n");
  const workerLicenses = writeWorkerLicenses(runtime);
  console.log(JSON.stringify({ package: metadata.name, version: metadata.version, assetFiles: fileCount, assetBytes: bytes, workerBytes: fs.statSync(worker).size, workerLicensePackages: workerLicenses.packages.length, workerLicenseBytes: workerLicenses.bytes }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
