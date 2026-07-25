// Native dimensions (after node scale) of the prop GLBs, so collider heights
// can be derived from the shipped art instead of guessed.
import fs from 'node:fs';
const files = {
  graveRound: 'gravestone_round', graveCross: 'gravestone_cross',
  graveBevel: 'gravestone_bevel', graveDecor: 'gravestone_decorative',
  barrel: 'barrel', farmCrate: 'farmcrate_apple', anvil: 'anvil',
  weaponStand: 'weapon_stand', cart: 'cart', crateWooden: 'crate_wooden',
  statueHead: 'statue_head', statueBlock: 'statue_block', rowboat: 'rowboat',
  mushroomRed: 'mushroom_red', mushroomTan: 'mushroom_tan',
  oreRocks: 'ore_rocks', timberPillar: 'timber_pillar', lanternWall: 'lantern_wall',
  dockPlatform: 'dock_platform', stand1: 'market_stand_1', stand2: 'market_stand_2',
};
for (const [key, name] of Object.entries(files)) {
  const path = `public/models/props/${name}.glb`;
  if (!fs.existsSync(path)) { console.log(key.padEnd(14), 'MISSING', path); continue; }
  const buf = fs.readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  // node scale per mesh, quantized accessors are normalized shorts
  let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  const nodesByMesh = new Map();
  for (const n of json.nodes ?? []) if (n.mesh !== undefined) nodesByMesh.set(n.mesh, n);
  json.meshes?.forEach((mesh, mi) => {
    const node = nodesByMesh.get(mi);
    const sc = node?.scale ?? [1,1,1];
    const tr = node?.translation ?? [0,0,0];
    for (const prim of mesh.primitives ?? []) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc?.min) continue;
      const norm = acc.normalized ? 32767 : 1;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], (acc.min[i]/norm) * sc[i] + tr[i]);
        max[i] = Math.max(max[i], (acc.max[i]/norm) * sc[i] + tr[i]);
      }
    }
  });
  console.log(key.padEnd(14), 'H=', (max[1]-min[1]).toFixed(3), ' minY=', min[1].toFixed(3),
    ' W=', (max[0]-min[0]).toFixed(3), ' D=', (max[2]-min[2]).toFixed(3));
}
