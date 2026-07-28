import urllib.request
import json
import urllib.parse

def search(query):
    url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
    req = urllib.request.Request(
        url,
        data=None,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
    )
    try:
        response = urllib.request.urlopen(req)
        html = response.read().decode('utf-8')
        # simple parsing
        import re
        links = re.findall(r'href="([^"]+)"', html)
        for link in links:
            if 'http' in link and 'duckduckgo' not in link:
                print(link)
    except Exception as e:
        print(e)

search("dragon gltf cc0 download")
