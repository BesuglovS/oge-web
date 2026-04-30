import os

os.chdir(r'e:\WebSites\oge-web\excel')

files = [
    'i.html', 'ili.html', 'maks.html', 'maksesli.html', 
    'min.html', 'minesli.html', 'ne.html', 'schet.html',
    'schetesli.html', 'scheteslimn.html', 'srznach.html',
    'srznachesli.html', 'srznacheslimn.html', 'summ.html',
    'summesli.html', 'summeslimn.html'
]

css_hover = '''      .related-link:hover {
        text-decoration: underline !important;
      }

      @media (max-width: 600px) {'''

for filename in files:
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already done
    if '.related-link' in content:
        print(f'{filename}: already has hover CSS, skipping')
        continue
    
    # Add class to function links in the related section
    if 'Связанные функции' in content:
        content = content.replace(
            'style="color:inherit;text-decoration:none;"',
            'class="related-link" style="color:inherit;text-decoration:none;"'
        )
        
        # Replace the media query line
        content = content.replace(
            '@media (max-width: 600px) {',
            css_hover
        )
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'{filename}: updated')
    else:
        print(f'{filename}: no related functions section, skipping')