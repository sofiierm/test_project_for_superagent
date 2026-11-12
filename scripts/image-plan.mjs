import fs from 'node:fs';

// Source metadata comes from Wikimedia Commons (license + author are recorded
// for attribution on credits.html). Only the optimized derivatives are committed.
const byTitle = Object.fromEntries(
  JSON.parse(fs.readFileSync('.tmp-tools/final.json', 'utf8')).map((x) => [x.title, x]),
);

const pick = (title) => {
  const src = byTitle[title];
  if (!src) throw new Error('Missing source metadata: ' + title);
  return src;
};

const licenses = {
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};

const plan = [
  {
    id: 'hero-interior',
    source: 'Modern luxury living room with kitchen interior.jpg',
    alt: 'Светлая гостиная с кухней: деревянные фасады, мягкий диван и большие окна',
    aspect: 16 / 9,
    widths: [960, 1440, 1920],
    sizes: '(max-width: 900px) 100vw, 100vw',
    hero: true,
  },
  {
    id: 'about-workshop',
    source: 'Woodworking shop filled with tools, materials, and unfinished furniture pieces during a busy workday.jpg',
    alt: 'Столярный цех: верстаки, инструменты и заготовки из дерева',
    aspect: 4 / 3,
    widths: [640, 960],
    sizes: '(max-width: 900px) 100vw, 50vw',
  },
  {
    id: 'about-craftsman',
    source: 'Woodworker uses a planer on a long piece of wood in a workshop during daylight hours.jpg',
    alt: 'Мастер строгает деревянную заготовку ручным рубанком в цехе',
    aspect: 3 / 4,
    widths: [480, 720],
    sizes: '(max-width: 900px) 60vw, 28vw',
  },
  {
    id: 'dir-kitchen',
    source: 'Blue white kitchen interior (Unsplash).jpg',
    alt: 'Кухня в сине-белой гамме с островом и открытыми полками',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'dir-wardrobe',
    source: 'Empty wooden wardrobe closeup.jpg',
    alt: 'Встроенный деревянный шкаф с полками и штангой для одежды',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'dir-living',
    source: 'Modern living room with stylish furniture and a view of the outdoors in a cozy apartment setting.jpg',
    alt: 'Гостиная с мягким диваном, деревянным столом и видом на улицу',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'dir-bedroom',
    source: 'Cozy modern bedroom with plush pillows and elegant drapes in bright daylight.jpg',
    alt: 'Спальня с мягким изголовьем, подушками и светлыми шторами',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'dir-dining',
    source: 'Elegant dining area in a modern apartment with wooden accents and stylish decor.jpg',
    alt: 'Обеденная зона с деревянным столом, стульями и настенным светом',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'dir-hall',
    source: 'Bright hallway in a modern building showcasing wood and marble design elements.jpg',
    alt: 'Прихожая с деревянными панелями и светлым каменным полом',
    aspect: 3 / 2,
    widths: [560, 840],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
  },
  {
    id: 'portfolio-kitchen',
    source: 'This cozy kitchen showcases modern design elements.jpg',
    alt: 'Кухня с деревянными акцентами, открытыми полками и большими окнами',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-wardrobe',
    source: 'Minimal Designer Wardrobe (Unsplash).jpg',
    alt: 'Гардеробная с открытыми полками, подсветкой и зеркалом',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-living',
    source: 'Bookshelf and blue couch (Unsplash).jpg',
    alt: 'Гостиная с книжным стеллажом во всю стену и синим диваном',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-bedroom',
    source: 'Modern bedroom design in a stylish hotel room featuring geometric patterns and soft linens.jpg',
    alt: 'Спальня в современном стиле с геометрическим панно у изголовья',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-dining',
    source: 'Round table in a bright room (Unsplash).jpg',
    alt: 'Обеденный стол у окна в светлой комнате с растениями',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-bath',
    source: 'Modern wooden vanity with round mirror in minimalistic interior design.jpg',
    alt: 'Ванная комната с деревянной тумбой и круглым зеркалом',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-hall',
    source: 'Bright hallway in a modern building showcasing wood and marble design elements.jpg',
    alt: 'Прихожая с деревянной стеной и мраморным полом',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'portfolio-living-detail',
    source: 'Coffee tables in front of a comfy sofa (Unsplash).jpg',
    alt: 'Гостиная с диваном и деревянными журнальными столами',
    aspect: 4 / 3,
    widths: [600, 900],
    sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw',
    portfolio: true,
  },
  {
    id: 'material-oak',
    source: 'Oak veneer 01 diff 16k (Jandre van Heerden via Poly Haven).png',
    alt: 'Крупным планом текстура шпона дуба',
    aspect: 4 / 3,
    widths: [560],
    sizes: '(max-width: 700px) 50vw, 25vw',
  },
  {
    id: 'material-walnut',
    source: 'American walnut veneer diff 8k (PNG).png',
    alt: 'Крупным планом текстура шпона американского ореха',
    aspect: 4 / 3,
    widths: [560],
    sizes: '(max-width: 700px) 50vw, 25vw',
  },
  {
    id: 'material-hinges',
    source: 'Various types of hinges displayed on a panel at a hardware store.jpg',
    alt: 'Витрина с мебельными петлями и доводчиками',
    aspect: 4 / 3,
    widths: [560],
    sizes: '(max-width: 700px) 50vw, 25vw',
  },
  {
    id: 'material-finish',
    source: 'Airbrush or paint spray gun for furniture and wood works.jpg',
    alt: 'Краскопульт для нанесения финишного покрытия на деревянные фасады',
    aspect: 4 / 3,
    widths: [560],
    sizes: '(max-width: 700px) 50vw, 25vw',
  },
];

const manifest = plan.map((item) => {
  const src = pick(item.source);
  if (!licenses[src.license] && src.license !== 'CC BY 2.0' && src.license !== 'CC0') {
    throw new Error('Unsupported license for ' + item.source + ': ' + src.license);
  }
  return {
    id: item.id,
    alt: item.alt,
    aspect: Number(item.aspect.toFixed(4)),
    widths: item.widths,
    sizes: item.sizes,
    hero: Boolean(item.hero),
    portfolio: Boolean(item.portfolio),
    source: {
      title: src.title,
      page: src.page,
      author: src.author,
      license: src.license,
      licenseUrl: src.licenseUrl || licenses[src.license] || '',
      originalWidth: src.w,
      originalHeight: src.h,
    },
    candidateFile: null,
  };
});

fs.writeFileSync('scripts/image-plan.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', manifest.length, 'entries');
