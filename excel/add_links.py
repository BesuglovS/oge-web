import os, re

os.chdir(r'e:\WebSites\oge-web\excel')

# Map of function names to their file paths (only functions that have pages)
FUNCTION_LINKS = {
    'ЕСЛИ': 'esli.html',
    'И': 'i.html',
    'ИЛИ': 'ili.html',
    'НЕ': 'ne.html',
    'СЧЁТ': 'schet.html',
    'СЧЁТЕСЛИ': 'schetesli.html',
    'СЧЁТЕСЛИМН': 'scheteslimn.html',
    'СУММ': 'summ.html',
    'СУММЕСЛИ': 'summesli.html',
    'СУММЕСЛИМН': 'summeslimn.html',
    'СРЗНАЧ': 'srznach.html',
    'СРЗНАЧЕСЛИ': 'srznachesli.html',
    'СРЗНАЧЕСЛИМН': 'srznacheslimn.html',
    'МИН': 'min.html',
    'МИНЕСЛИ': 'minesli.html',
    'МАКС': 'maks.html',
    'МАКСЕСЛИ': 'maksesli.html',
}

files_to_process = [
    'i.html', 'ili.html', 'maks.html', 'maksesli.html',
    'min.html', 'minesli.html', 'ne.html', 'schet.html',
    'schetesli.html', 'scheteslimn.html', 'srznach.html',
    'srznachesli.html', 'srznacheslimn.html', 'summ.html',
    'summesli.html', 'summeslimn.html'
]

for filename in files_to_process:
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find the "Связанные функции" section
    idx = content.find('Связанные функции')
    if idx == -1:
        print(f'{filename}: no "Связанные функции" section, skipping')
        continue
    
    # Find the <p> inside this section
    p_start = content.find('<p>', idx)
    p_end = content.find('</p>', p_start)
    p_content = content[p_start:p_end + 4]
    
    # Replace function names with links
    new_p = p_content
    # Need to sort by length (longest first) to avoid partial replacements
    for func_name in sorted(FUNCTION_LINKS.keys(), key=len, reverse=True):
        link_file = FUNCTION_LINKS[func_name]
        # Only replace when inside <strong> tags
        old_pattern = f'<strong>{func_name}</strong>'
        new_pattern = f'<strong><a href="{link_file}" style="color:inherit;text-decoration:none;">{func_name}</a></strong>'
        if old_pattern in new_p:
            new_p = new_p.replace(old_pattern, new_pattern)
    
    if new_p != p_content:
        content = content[:p_start] + new_p + content[p_end + 4:]
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(content)
        # Show what changed
        print(f'{filename}: updated')
        for func_name in sorted(FUNCTION_LINKS.keys(), key=len, reverse=True):
            old = f'<strong>{func_name}</strong>'
            if old in p_content and old not in new_p:
                print(f'  - {func_name} -> {FUNCTION_LINKS[func_name]}')
    else:
        print(f'{filename}: no changes needed')