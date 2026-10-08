/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — what can be put in a scene (PLAN "3D Studio - план по этапам", 3D1).

   The furniture is Kenney's Furniture Kit (CC0, vendor/3d/furniture/, tools/fetch-3d.js). Its sizes are its own -
   a doorway is about one unit - so every model is scaled UNIFORMLY to one real measure written here:
     h   its height in metres (most things)
     l   its longest side on the floor (beds, a bathtub, rugs, flat things whose height says nothing)
   The figures are Mesh2Motion's male and female (vendor/3d/people/), scaled to a person's height.
   ════════════════════════════════════════════════════════════════════════════ */

export const PEOPLE = {
  male: { file: '/vendor/3d/people/male.glb', h: 1.78 },
  female: { file: '/vendor/3d/people/female.glb', h: 1.66 },
};
export const MOTIONS = ['/vendor/3d/people/motions-base.glb', '/vendor/3d/people/motions-addon.glb'];
// The pose a figure stands in while nothing moves it: the first moment of this motion (its bind pose is a T).
export const REST_MOTION = 'Idle_A';

export const FURNITURE_DIR = '/vendor/3d/furniture/';

// [model, name, measure] by group, in the order the furniture window shows them.
const GROUPS = [
  ['Seating', [
    ['loungeSofa', 'Sofa', { h: 0.85 }], ['loungeSofaLong', 'Long sofa', { h: 0.85 }], ['loungeSofaCorner', 'Corner sofa', { h: 0.85 }],
    ['loungeSofaOttoman', 'Ottoman', { h: 0.42 }], ['loungeDesignSofa', 'Design sofa', { h: 0.8 }], ['loungeDesignSofaCorner', 'Design corner sofa', { h: 0.8 }],
    ['loungeChair', 'Armchair', { h: 0.85 }], ['loungeChairRelax', 'Lounge chair', { h: 0.9 }], ['loungeDesignChair', 'Design armchair', { h: 0.8 }],
    ['chair', 'Chair', { h: 0.9 }], ['chairCushion', 'Cushioned chair', { h: 0.9 }], ['chairDesk', 'Office chair', { h: 1.0 }],
    ['chairModernCushion', 'Modern chair', { h: 0.85 }], ['chairModernFrameCushion', 'Frame chair', { h: 0.85 }], ['chairRounded', 'Round chair', { h: 0.85 }],
    ['stoolBar', 'Bar stool', { h: 0.75 }], ['stoolBarSquare', 'Square bar stool', { h: 0.75 }],
    ['bench', 'Bench', { h: 0.45 }], ['benchCushion', 'Cushioned bench', { h: 0.5 }], ['benchCushionLow', 'Low bench', { h: 0.4 }],
  ]],
  ['Tables', [
    ['table', 'Table', { h: 0.75 }], ['tableCloth', 'Table with cloth', { h: 0.75 }], ['tableCross', 'Cross-leg table', { h: 0.75 }],
    ['tableCrossCloth', 'Cross-leg table, cloth', { h: 0.75 }], ['tableGlass', 'Glass table', { h: 0.75 }], ['tableRound', 'Round table', { h: 0.75 }],
    ['tableCoffee', 'Coffee table', { h: 0.42 }], ['tableCoffeeSquare', 'Square coffee table', { h: 0.42 }],
    ['tableCoffeeGlass', 'Glass coffee table', { h: 0.42 }], ['tableCoffeeGlassSquare', 'Square glass coffee table', { h: 0.42 }],
    ['desk', 'Desk', { h: 0.75 }], ['deskCorner', 'Corner desk', { h: 0.75 }],
    ['sideTable', 'Side table', { h: 0.55 }], ['sideTableDrawers', 'Side table with drawers', { h: 0.6 }],
    ['kitchenBar', 'Bar counter', { h: 1.05 }], ['kitchenBarEnd', 'Bar counter end', { h: 1.05 }],
  ]],
  ['Beds', [
    ['bedDouble', 'Double bed', { l: 2.1 }], ['bedSingle', 'Single bed', { l: 2.0 }], ['bedBunk', 'Bunk bed', { h: 1.6 }],
    ['cabinetBed', 'Bedside cabinet', { h: 0.55 }], ['cabinetBedDrawer', 'Bedside drawers', { h: 0.55 }], ['cabinetBedDrawerTable', 'Bedside table', { h: 0.6 }],
  ]],
  ['Storage', [
    ['bookcaseOpen', 'Open bookcase', { h: 1.9 }], ['bookcaseOpenLow', 'Low bookcase', { h: 0.9 }], ['bookcaseClosed', 'Bookcase', { h: 1.9 }],
    ['bookcaseClosedDoors', 'Bookcase with doors', { h: 1.9 }], ['bookcaseClosedWide', 'Wide bookcase', { h: 1.9 }],
    ['cabinetTelevision', 'TV stand', { h: 0.5 }], ['cabinetTelevisionDoors', 'TV cabinet', { h: 0.5 }],
    ['coatRackStanding', 'Coat stand', { h: 1.8 }], ['coatRack', 'Wall coat rack', { h: 0.25 }],
    ['cardboardBoxClosed', 'Box', { h: 0.4 }], ['cardboardBoxOpen', 'Open box', { h: 0.4 }], ['books', 'Books', { h: 0.25 }],
  ]],
  ['Kitchen', [
    ['kitchenCabinet', 'Kitchen cabinet', { h: 0.9 }], ['kitchenCabinetDrawer', 'Kitchen drawers', { h: 0.9 }],
    ['kitchenCabinetCornerInner', 'Corner cabinet', { h: 0.9 }], ['kitchenCabinetCornerRound', 'Round corner cabinet', { h: 0.9 }],
    ['kitchenCabinetUpper', 'Wall cabinet', { h: 0.7 }], ['kitchenCabinetUpperDouble', 'Double wall cabinet', { h: 0.7 }],
    ['kitchenCabinetUpperCorner', 'Corner wall cabinet', { h: 0.7 }], ['kitchenCabinetUpperLow', 'Low wall cabinet', { h: 0.4 }],
    ['kitchenSink', 'Kitchen sink', { h: 0.9 }], ['kitchenStove', 'Stove', { h: 0.9 }], ['kitchenStoveElectric', 'Electric stove', { h: 0.9 }],
    ['kitchenFridge', 'Fridge', { h: 1.8 }], ['kitchenFridgeLarge', 'Large fridge', { h: 1.85 }], ['kitchenFridgeSmall', 'Small fridge', { h: 0.85 }],
    ['kitchenFridgeBuiltIn', 'Built-in fridge', { h: 1.8 }], ['hoodModern', 'Cooker hood', { h: 0.6 }], ['hoodLarge', 'Large cooker hood', { h: 0.6 }],
    ['kitchenMicrowave', 'Microwave', { h: 0.3 }], ['kitchenCoffeeMachine', 'Coffee machine', { h: 0.35 }],
    ['kitchenBlender', 'Blender', { h: 0.4 }], ['toaster', 'Toaster', { h: 0.2 }],
    ['washer', 'Washing machine', { h: 0.85 }], ['dryer', 'Dryer', { h: 0.85 }], ['washerDryerStacked', 'Washer and dryer', { h: 1.7 }],
  ]],
  ['Bathroom', [
    ['bathtub', 'Bathtub', { l: 1.7 }], ['shower', 'Shower', { h: 2.0 }], ['showerRound', 'Round shower', { h: 2.0 }],
    ['toilet', 'Toilet', { h: 0.8 }], ['toiletSquare', 'Square toilet', { h: 0.8 }],
    ['bathroomSink', 'Washbasin', { h: 0.9 }], ['bathroomSinkSquare', 'Square washbasin', { h: 0.9 }],
    ['bathroomCabinet', 'Bathroom cabinet', { h: 0.6 }], ['bathroomCabinetDrawer', 'Bathroom drawers', { h: 0.85 }], ['bathroomMirror', 'Mirror', { h: 0.7 }],
  ]],
  ['Electronics', [
    ['televisionModern', 'TV', { h: 0.7 }], ['televisionVintage', 'Old TV', { h: 0.5 }], ['televisionAntenna', 'TV antenna', { h: 0.3 }],
    ['computerScreen', 'Monitor', { h: 0.45 }], ['laptop', 'Laptop', { l: 0.35 }], ['computerKeyboard', 'Keyboard', { l: 0.45 }], ['computerMouse', 'Mouse', { l: 0.1 }],
    ['radio', 'Radio', { h: 0.2 }], ['speaker', 'Speaker', { h: 1.0 }], ['speakerSmall', 'Small speaker', { h: 0.3 }],
  ]],
  ['Lights', [
    ['lampRoundFloor', 'Floor lamp', { h: 1.6 }], ['lampSquareFloor', 'Square floor lamp', { h: 1.6 }],
    ['lampRoundTable', 'Table lamp', { h: 0.5 }], ['lampSquareTable', 'Square table lamp', { h: 0.5 }],
    ['lampSquareCeiling', 'Ceiling lamp', { h: 0.2 }], ['lampWall', 'Wall lamp', { h: 0.3 }], ['ceilingFan', 'Ceiling fan', { l: 1.2 }],
  ]],
  ['Decor', [
    ['pottedPlant', 'Potted plant', { h: 1.2 }], ['plantSmall1', 'Small plant', { h: 0.3 }], ['plantSmall2', 'Small plant 2', { h: 0.3 }], ['plantSmall3', 'Small plant 3', { h: 0.3 }],
    ['rugRectangle', 'Rug', { l: 2.4 }], ['rugRound', 'Round rug', { l: 2.0 }], ['rugRounded', 'Rounded rug', { l: 2.0 }], ['rugSquare', 'Square rug', { l: 2.0 }],
    ['rugDoormat', 'Doormat', { l: 0.8 }], ['pillow', 'Pillow', { l: 0.45 }], ['pillowLong', 'Long pillow', { l: 0.7 }],
    ['bear', 'Teddy bear', { h: 0.35 }], ['trashcan', 'Bin', { h: 0.45 }],
  ]],
  ['Doors and walls', [
    ['doorway', 'Door', { h: 2.1 }], ['doorwayOpen', 'Open door', { h: 2.1 }], ['doorwayFront', 'Front door', { h: 2.1 }],
    ['wall', 'Wall', { h: 2.7 }], ['wallWindow', 'Wall with window', { h: 2.7 }], ['wallWindowSlide', 'Wall with sliding window', { h: 2.7 }],
    ['wallDoorway', 'Wall with doorway', { h: 2.7 }], ['wallDoorwayWide', 'Wall with wide doorway', { h: 2.7 }],
    ['wallCorner', 'Wall corner', { h: 2.7 }], ['stairs', 'Stairs', { h: 2.7 }], ['stairsOpen', 'Open stairs', { h: 2.7 }],
  ]],
];

export const FURNITURE = GROUPS.map(([group, items]) => ({
  group,
  items: items.map(([id, name, m]) => ({ id, name, h: m.h || 0, l: m.l || 0, file: FURNITURE_DIR + id + '.glb', preview: FURNITURE_DIR + 'preview/' + id + '.png' })),
}));
const _byId = new Map(FURNITURE.flatMap(g => g.items).map(it => [it.id, it]));
export const furnitureItem = (id) => _byId.get(id) || null;

// The colours a new object takes, in turn: far apart in hue, light enough to read on the dark editor and on the
// clay background. A track on the timeline (3D2) wears its object's colour.
export const PALETTE = ['#e5484d', '#3e8ef7', '#46a758', '#f5a524', '#a259ff', '#12a5b4', '#e8659c', '#8fb83d', '#f07a3a', '#6e7bf2', '#c79a5b', '#3fbfa0'];
export const ROOM_COLOR = '#b9b9b9';
// Cameras: their own run of colours (3D4), the first one gold.
export const CAMERA_COLORS = ['#e8c35a', '#5ad1e8', '#e85ac8', '#9be85a', '#e8875a', '#8a7cf0'];
