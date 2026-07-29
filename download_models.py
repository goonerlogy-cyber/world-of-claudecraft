import urllib.request

def download_file(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response, open(path, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
            print(f"Downloaded {path}")
    except Exception as e:
        print(f"Failed to download {path}: {e}")

# This is a sample dragon, but let's see if we can find something better.
download_file('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DragonAttenuation/glTF-Binary/DragonAttenuation.glb', 'public/models/creatures/dragonevolved.glb')
# Just for a quick replace, I'll use some sample knight or similar
download_file('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/RiggedFigure/glTF-Binary/RiggedFigure.glb', 'public/models/chars/players/knight.glb')
download_file('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/RiggedFigure/glTF-Binary/RiggedFigure.glb', 'public/models/chars/players/barbarian.glb')
