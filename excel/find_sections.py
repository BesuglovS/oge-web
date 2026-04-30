import os, glob, sys

os.chdir(r'e:\WebSites\oge-web\excel')
with open('sections_output.txt', 'w', encoding='utf-8') as out:
    for f in sorted(glob.glob('*.html')):
        with open(f, 'r', encoding='utf-8') as fh:
            content = fh.read()
        idx = content.find('Связанные функции')
        if idx >= 0:
            start = content.rfind('<div class="theory-section">', 0, idx)
            end = content.find('</div>', idx) + 6
            end = content.find('</div>', end) + 6
            out.write(f'\n=== {f} ===\n')
            out.write(content[start:end])
            out.write('\n')