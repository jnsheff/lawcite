#!/usr/bin/env python3
"""Build dist/lawcite-<version>.xpi from the three modules.

  python3 build.py            build the xpi (and verify its contents)

Steps
  1. modules/translators/build.py     assemble the "(legal)" web translators from src/
  2. esbuild (if found)               bundle modules/phoenix/lib/main.mjs -> content/citation-phoenix.js
                                      (set ESBUILD=/path/to/esbuild, or put esbuild on PATH; otherwise the
                                      committed bundle is used and a warning is printed)
  3. generate-schema-ftl.py           locale/<lang>/citation-phoenix.ftl  (REQUIRED in the xpi: without it Zotero's
                                      menu localization fails and the item context menu does not open)
  4. stage + zip                      .stage/ -> dist/lawcite-<version>.xpi
  5. verify                           required files present, ftl count, translators match the bootstrap's list
"""
import json, os, re, shutil, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PHOENIX = os.path.join(ROOT, 'modules', 'phoenix')
HICITE = os.path.join(ROOT, 'modules', 'hicite', 'addon')
TRANSL = os.path.join(ROOT, 'modules', 'translators')
STAGE = os.path.join(ROOT, '.stage')
DIST = os.path.join(ROOT, 'dist')

def run(cmd, cwd=ROOT):
    print('  $', ' '.join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)

def copytree(src, dst):
    shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.DS_Store', '__pycache__'))

def main():
    manifest = json.load(open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8'))
    version = manifest['version']
    print(f'lawcite {version}')

    print('1. translators')
    run([sys.executable, 'build.py'], cwd=TRANSL)

    print('2. citation-phoenix bundle')
    esbuild = os.environ.get('ESBUILD') or shutil.which('esbuild')
    if esbuild:
        run([esbuild, 'lib/main.mjs', '--bundle', '--format=iife', '--global-name=CitationPhoenix',
             '--platform=browser', '--outfile=content/citation-phoenix.js'], cwd=PHOENIX)
    else:
        print('  WARNING: esbuild not found (set ESBUILD=...); using the committed bundle. If lib/ changed, it is stale.')

    print('3. schema ftl')
    shutil.rmtree(os.path.join(PHOENIX, 'locale'), ignore_errors=True)
    run([sys.executable, 'scripts/generate-schema-ftl.py', PHOENIX], cwd=PHOENIX)

    print('4. stage')
    shutil.rmtree(STAGE, ignore_errors=True)
    os.makedirs(STAGE)
    for name in ('content', 'styles', 'style-modules', 'juris-abbrevs', 'juris-maps', 'locale'):
        copytree(os.path.join(PHOENIX, name), os.path.join(STAGE, name))
    # hicite: everything but its own manifest/prefs/locale, which are merged into the root
    for name in os.listdir(HICITE):
        if name in ('manifest.json', 'prefs.js', 'locale', '.DS_Store'):
            continue
        src = os.path.join(HICITE, name)
        dst = os.path.join(STAGE, 'hicite', name)
        if os.path.isdir(src):
            copytree(src, dst)
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    copytree(os.path.join(HICITE, 'locale'), os.path.join(STAGE, 'locale'))
    shutil.copy2(os.path.join(HICITE, 'prefs.js'), os.path.join(STAGE, 'prefs.js'))
    # lawcite's icon (assets/icon.svg): the plugin icon, and the image citation-phoenix's Settings pane loads
    shutil.copy2(os.path.join(ROOT, 'assets', 'icon.svg'), os.path.join(STAGE, 'icon.svg'))
    shutil.copy2(os.path.join(ROOT, 'assets', 'icon.svg'), os.path.join(STAGE, 'content', 'ui', 'icon48.svg'))
    copytree(os.path.join(TRANSL, 'translators'), os.path.join(STAGE, 'translators'))
    for name in ('manifest.json', 'bootstrap.js'):
        shutil.copy2(os.path.join(ROOT, name), os.path.join(STAGE, name))

    print('5. zip')
    os.makedirs(DIST, exist_ok=True)
    xpi = os.path.join(DIST, f'lawcite-{version}.xpi')
    if os.path.exists(xpi):
        os.remove(xpi)
    with zipfile.ZipFile(xpi, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(STAGE):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, STAGE))
    verify(xpi)
    print(f'built {xpi} ({os.path.getsize(xpi) // 1024} KB)')

def verify(xpi):
    names = set(zipfile.ZipFile(xpi).namelist())
    problems = []
    for need in ('manifest.json', 'bootstrap.js', 'prefs.js', 'icon.svg', 'content/ui/icon48.svg', 'content/citation-phoenix.js', 'content/schema.json',
                 'content/localization.json', 'styles/index.json', 'style-modules/index.json',
                 'juris-abbrevs/DIRECTORY_LISTING.json', 'juris-maps/primary-jurisdictions.json',
                 'hicite/hicite-export.js', 'hicite/preferences.xhtml', 'hicite/translator/hicite.js',
                 'locale/en-US/hicite-export.ftl', 'locale/en-US/citation-phoenix.ftl',
                 'styles/lawcite-indigobook-lawreview.csl', 'styles/lawcite-indigobook-memoranda.csl',
                 'styles/lawcite-apa.csl'):
        if need not in names:
            problems.append('missing ' + need)
    z = zipfile.ZipFile(xpi)
    if '>LC<' not in z.read('icon.svg').decode('utf-8') or z.read('icon.svg') != z.read('content/ui/icon48.svg'):
        problems.append('icon.svg is not the lawcite icon, or content/ui/icon48.svg differs from it')
    ftl = [n for n in names if n.endswith('citation-phoenix.ftl')]
    if len(ftl) < 40:
        problems.append(f'only {len(ftl)} citation-phoenix.ftl files (expected ~48)')
    boot = open(os.path.join(ROOT, 'bootstrap.js'), encoding='utf-8').read()
    listed = set(re.findall(r"'([^']+ \(legal\)\.js)'", boot))
    shipped = {n[len('translators/'):] for n in names if n.startswith('translators/') and n.endswith('.js')}
    if listed != shipped:
        problems.append(f'bootstrap translator list != translators/: {sorted(listed ^ shipped)}')
    for banned in ('translators/Westlaw.js', 'translators/Lexis+.js'):
        if banned in names:
            problems.append('duplicate translator shipped: ' + banned)
    if problems:
        print('VERIFY FAILED:\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print(f'verify ok ({len(names)} entries, {len(ftl)} ftl, {len(shipped)} translators)')

if __name__ == '__main__':
    main()
