// scripts/build-unit-dictionary-v2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'data', 'units', 'unitDictionary.json');

const units = [
  // ==========================================
  // MASS (Base Unit: kg) - 28 Units
  // ==========================================
  {
    code: "kg",
    name: "Kilogram",
    vernacularName: "किलोग्राम / किलो",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "flour",
      "rice",
      "sugar",
      "dal",
      "pulses",
      "potatoes",
      "onions",
      "vegetables",
      "fruits",
      "dry fruits",
      "loose spices"
    ],
    aliases: [
      "kg",
      "kilo",
      "kilogram",
      "kilograms",
      "kilos",
      "kg.",
      "kgs",
      "killo",
      "किग्रा",
      "किलो",
      "किलोग्राम",
      "कीलो",
      "கிலோ",
      "కిలో",
      "કિલો",
      "কেজি",
      "ಕಿಲೋಗ್ರಾಂ",
      "കിലോ",
      "ਕਿਲੋ",
      "କିଲୋ",
      "କେଜି"
    ],
    description: "Universal metric standard base unit for mass across all retail, wholesale, and mandi operations in India."
  },
  {
    code: "g",
    name: "Gram",
    vernacularName: "ग्राम",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.001,
    isFixed: true,
    defaultForCommodities: [
      "spices",
      "cardamom",
      "cloves",
      "cinnamon",
      "black pepper",
      "dry fruits",
      "tea powder",
      "coffee",
      "paneer",
      "loose yeast"
    ],
    aliases: [
      "g",
      "gm",
      "gms",
      "gram",
      "grams",
      "gramme",
      "grammes",
      "ग्राम",
      "ग्रा.",
      "கிராம்",
      "గ్రాము",
      "ગ્રામ",
      "গ্রাম",
      "ಗ್ರಾಂ",
      "ഗ്രാം",
      "ਗ੍ਰਾਮ",
      "ଗ୍ରାମ"
    ],
    description: "Sub-unit of kilogram used for loose ground spices, premium whole spices, dry fruits, condiments, tea, and smaller retail confectionery."
  },
  {
    code: "mg",
    name: "Milligram",
    vernacularName: "मिलीग्राम",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.000001,
    isFixed: true,
    defaultForCommodities: [
      "saffron",
      "kesar",
      "ayurvedic herbs",
      "bhasma",
      "chandi vark",
      "silver leaf",
      "gold leaf",
      "swarna bhasma"
    ],
    aliases: [
      "mg",
      "mgs",
      "milligram",
      "milligrams",
      "मिलीग्राम",
      "मिग्रा",
      "मि.ग्रा.",
      "மில்லிகிராம்",
      "మిల్లీగ్రామ్",
      "મિલિગ્રામ",
      "মিলিগ্রাম",
      "ಮಿಲಿಗ್ರಾಂ",
      "മില്ലിഗ്രാം"
    ],
    description: "Micro-weight metric unit used for high-value micro-dispensed inventory such as Kashmiri saffron, ayurvedic preparations, and edible silver foil."
  },
  {
    code: "quintal",
    name: "Quintal",
    vernacularName: "क्विंटल / क्विन्टल",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 100.0,
    isFixed: true,
    defaultForCommodities: [
      "wheat",
      "paddy",
      "unpolished rice",
      "mustard seeds",
      "soybean",
      "grains",
      "onions",
      "potatoes",
      "coarse grains"
    ],
    aliases: [
      "quintal",
      "quintals",
      "qtl",
      "qtls",
      "kintal",
      "quintel",
      "क्विंटल",
      "क्विन्टल",
      "क्विంటాల్",
      "ക്വിന്റൽ",
      "குவிண்டால்",
      "ક્વિન્ટલ",
      "কুইন্টাল",
      "ಕ್ವಿಂಟಾಲ್",
      "ਕੁਇੰਟਲ",
      "କ୍ୱିଣ୍ଟାଲ"
    ],
    description: "Primary wholesale and APMC mandi benchmark trading unit equal to exactly 100 kilograms. Used for grain auctions, procurement tempos, and farm produce sales."
  },
  {
    code: "tonne",
    name: "Metric Ton (Tonne)",
    vernacularName: "मीट्रिक टन / टन",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 1000.0,
    isFixed: true,
    defaultForCommodities: [
      "bulk grain shipments",
      "flour mill consignments",
      "sugar mill trucks",
      "bulk salt truckloads",
      "fertilizers",
      "feed wholesale"
    ],
    aliases: [
      "ton",
      "tonne",
      "tons",
      "tonnes",
      "mt",
      "metric ton",
      "metric tonne",
      "टन",
      "मीट्रिक टन",
      "டൺ",
      "టన్ను",
      "ટન",
      "টন",
      "ಟನ್",
      "ਟਨ",
      "ଟନ"
    ],
    description: "Macro bulk unit equal to 1,000 kilograms. Used for freight truckloads, wholesale mill arrivals, and B2B distributor receipts."
  },
  {
    code: "bori",
    name: "Sack / Gunny Bag (Bori)",
    vernacularName: "बोरी (50kg बोरी)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 50.0,
    isFixed: false,
    defaultForCommodities: [
      "sugar",
      "rice",
      "wheat",
      "atta",
      "dal",
      "pulses",
      "potatoes",
      "onions"
    ],
    aliases: [
      "bori",
      "gunny bag",
      "sack",
      "bag",
      "jute bag",
      "pp bag",
      "poly bag",
      "boriyan",
      "boriya",
      "boriyo",
      "borey",
      "बोरी",
      "बोरियां",
      "बोरीयां",
      "बोरियों",
      "बस्ता",
      "బస్తా",
      "சாக்கு",
      "ಚೀಲ",
      "বস্তা",
      "ചാക്ക്",
      "ਬੋਰੀ",
      "ବସ୍ତା"
    ],
    description: "Standard wholesale woven polypropylene or jute sack standardized to 50 kg across Indian Mandis and Kiranas. Potato and onion sacks can vary between 50 kg and 55 kg."
  },
  {
    code: "katta",
    name: "Mini Sack / Katta (25kg - 30kg)",
    vernacularName: "कट्टा / छोटा बोरा (25kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 25.0,
    isFixed: false,
    defaultForCommodities: [
      "maida",
      "sooji",
      "besan",
      "branded chakki atta 25kg",
      "cattle feed 25kg",
      "poultry feed"
    ],
    aliases: [
      "katta",
      "katte",
      "kattey",
      "kattiyan",
      "kattiyo",
      "chota katta",
      "mini bag",
      "small sack",
      "कट्टा",
      "कट्टे",
      "कट्टियां",
      "कट्टियों",
      "छोटा कट्टा",
      "ಚಿಕ್ಕ ಚೀಲ",
      "కట్టా",
      "ਕੱਟਾ",
      "କଟ୍ଟା"
    ],
    description: "Medium-sized agricultural sack typically holding 25 kg to 30 kg, standard for processed mill flours (maida, sooji, besan) and branded wheat flour packs."
  },
  {
    code: "bora",
    name: "Heavy Jute Sack (Bora - 100kg)",
    vernacularName: "बड़ा बोरा (100kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 100.0,
    isFixed: false,
    defaultForCommodities: [
      "paddy",
      "uncleaned wheat",
      "coarse grains",
      "rural mandi procurement",
      "soybean arrivals"
    ],
    aliases: [
      "bora",
      "bore",
      "bada bora",
      "jute bora",
      "100kg bora",
      "बोरा",
      "बोरे",
      "बड़ा बोरा",
      "বড় বস্তা",
      "పెద్ద బస్తా",
      "ਬੋਰਾ"
    ],
    description: "Traditional heavy jute sack used in rural APMC mandis holding 100 kg (1 quintal) of unpolished grains or paddy directly from harvesting combines."
  },
  {
    code: "mann",
    name: "Maund (Mann)",
    vernacularName: "मण / मन",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 40.0,
    isFixed: false,
    defaultForCommodities: [
      "wheat",
      "raw cotton (kapas)",
      "mustard seed auctions",
      "jaggery",
      "fodder",
      "groundnut pods"
    ],
    aliases: [
      "mann",
      "maund",
      "man",
      "mon",
      "maunde",
      "मण",
      "मन",
      "મણ",
      "মণ",
      "ಮಣ",
      "మణుగు",
      "ਮਣ",
      "ମଣ"
    ],
    description: "Traditional Indian agrarian weight unit equal to 40 kg in Northern and Eastern India (Pakka Mann). Note: In Gujarat and Western India, 1 Mann (Kacchi Mann) equals 20 kg."
  },
  {
    code: "seer",
    name: "Seer (Ser)",
    vernacularName: "सेर / शेर",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.9331,
    isFixed: false,
    defaultForCommodities: [
      "loose grains",
      "desi ghee",
      "mustard oil",
      "jaggery blocks",
      "traditional village trade"
    ],
    aliases: [
      "seer",
      "ser",
      "sher",
      "seers",
      "सेर",
      "शेर",
      "সের",
      "ಸೇರು",
      "శేరు",
      "ਸੇਰ",
      "ସେର"
    ],
    description: "Historical pre-metric mass measure equal to 80 tolas (~933.1 grams). Still prevalent in rural North Indian, Bihari, and Bengali oral transactions."
  },
  {
    code: "paseri",
    name: "Paseri / Panseri / Dhari (5kg)",
    vernacularName: "पसेरी / धड़ी (5kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 5.0,
    isFixed: true,
    defaultForCommodities: [
      "potatoes",
      "onions",
      "seasonal vegetables",
      "mustard seeds",
      "jaggery chunks",
      "cattle salt"
    ],
    aliases: [
      "paseri",
      "panseri",
      "dhari",
      "panjseri",
      "5kg measure",
      "पसेरी",
      "पनसेरी",
      "धड़ी",
      "धडी",
      "પસેરી",
      "ਪਸੇਰੀ",
      "ਧੜੀ"
    ],
    description: "Traditional North Indian and Bihari 5-seer weight equal to exactly 5 kilograms. Known as Paseri in UP/Bihar and Dhari in Punjab/Haryana/Rajasthan."
  },
  {
    code: "chhatak",
    name: "Chhatak",
    vernacularName: "छटांक / छटाक",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.05832,
    isFixed: true,
    defaultForCommodities: [
      "loose mustard oil",
      "hookah tobacco",
      "desi ghee",
      "expensive spices",
      "snuff"
    ],
    aliases: [
      "chhatak",
      "chatak",
      "chhatank",
      "छटांक",
      "छटाक",
      "छटांकी",
      "ছটাক",
      "છટાંક"
    ],
    description: "Traditional sub-unit of the Seer (1/16th of a seer = 5 tolas ≈ 58.32 grams). Extensively used in Bengal, Bihar, and UP for dispensing small loose quantities."
  },
  {
    code: "tola",
    name: "Tola",
    vernacularName: "तोला / तोळा",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.01,
    isFixed: true,
    defaultForCommodities: [
      "saffron (kesar)",
      "cardamom (elaichi)",
      "silver leaf (chandi vark)",
      "ayurvedic ingredients",
      "camphor"
    ],
    aliases: [
      "tola",
      "tolas",
      "tole",
      "तोला",
      "तोले",
      "तोळा",
      "તોલા",
      "তোলা",
      "తులం",
      "ತೊಲ",
      "തൊല",
      "ਤੋਲਾ",
      "ତୋଳା"
    ],
    description: "Ancient Vedic mass unit standardized to 10.0 grams in modern Indian bullion and luxury Kirana trade (saffron, high-grade spices)."
  },
  {
    code: "ratti",
    name: "Ratti",
    vernacularName: "रत्ती",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.0001215,
    isFixed: true,
    defaultForCommodities: [
      "astrological stones",
      "swarna bhasma",
      "rare herbs",
      "pure musk (kasturi)",
      "silajit"
    ],
    aliases: [
      "ratti",
      "rati",
      "rattis",
      "रत्ती",
      "रती",
      "ரத்தி",
      "రత్తి",
      "રત્તી"
    ],
    description: "Traditional micro-mass unit derived from the seed of Abrus precatorius, equal to ~0.1215 grams. Standard for ayurvedic rasayanas and precious gems."
  },
  {
    code: "paav",
    name: "Paav / Quarter Kilo (250g)",
    vernacularName: "पाव / पाव भर (250 ग्राम)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.25,
    isFixed: true,
    defaultForCommodities: [
      "green chillies",
      "ginger",
      "garlic",
      "paneer",
      "makhana",
      "loose tea powder",
      "cumin seeds",
      "fresh vegetables"
    ],
    aliases: [
      "paav",
      "pav",
      "pao",
      "paav bhar",
      "pav bhar",
      "poya",
      "poa",
      "पाव",
      "पाव भर",
      "पोवा",
      "পোয়া",
      "பாவு",
      "ಪಾವು",
      "ਪਾਅ",
      "ପୋଆ"
    ],
    description: "Universal Indian quarter-kilogram (250 grams) retail measurement. Used dozens of times daily at every Indian Kirana counter."
  },
  {
    code: "adha_paav",
    name: "Half Paav (125g)",
    vernacularName: "आधा पाव (125 ग्राम)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.125,
    isFixed: true,
    defaultForCommodities: [
      "cardamom",
      "cloves",
      "black pepper",
      "asafoetida",
      "dry fruits",
      "fenugreek seeds",
      "loose tea"
    ],
    aliases: [
      "adha paav",
      "aadha paav",
      "aadha pav",
      "half paav",
      "125g",
      "125 gm",
      "आधा पाव",
      "আধ পোয়া",
      "ಅರ್ಧ ಪಾವು"
    ],
    description: "One eighth of a kilogram (125 grams) or half a paav. Very common request for whole spices and dry fruits."
  },
  {
    code: "dedh_paav",
    name: "One and a Half Paav (375g)",
    vernacularName: "डेढ़ पाव (375 ग्राम)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.375,
    isFixed: true,
    defaultForCommodities: [
      "fox nuts (makhana)",
      "fresh paneer",
      "loose sweets",
      "seasonal berries",
      "khoya"
    ],
    aliases: [
      "dedh paav",
      "derh paav",
      "dedh pav",
      "375g",
      "375 gm",
      "डेढ़ पाव",
      "डेढ़ पाव",
      "দেড় পোয়া"
    ],
    description: "Colloquial fractional unit equal to 1.5 paavs (375 grams). Prevalent in sweetshops, dairy counters, and loose grocery stores."
  },
  {
    code: "adha_kilo",
    name: "Half Kilogram (500g)",
    vernacularName: "आधा किलो (500 ग्राम)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.5,
    isFixed: true,
    defaultForCommodities: [
      "sugar",
      "pulses",
      "atta",
      "desi ghee",
      "cooking oil",
      "vegetables",
      "salt",
      "paneer"
    ],
    aliases: [
      "adha kilo",
      "aadha kilo",
      "half kg",
      "half kilo",
      "500g",
      "500 gm",
      "500 grams",
      "आधा किलो",
      "आधा कीलो",
      "અડધો કિલો",
      "আধ কেজি",
      "அரை கிலோ",
      "అర కిలో",
      "ಅರ್ಧ ಕಿಲೋ",
      "അര കിലോ",
      "ਅੱਧਾ ਕਿਲੋ",
      "ଅଧା କିଲୋ"
    ],
    description: "Colloquial half-kilogram (500 grams) unit. Standard consumer retail size across all grocery commodities."
  },
  {
    code: "lb",
    name: "Pound",
    vernacularName: "पाउंड",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.453592,
    isFixed: true,
    defaultForCommodities: [
      "commercial bakery bread loaves",
      "celebration cakes",
      "pastries",
      "gourmet coffee"
    ],
    aliases: [
      "lb",
      "lbs",
      "pound",
      "pounds",
      "पाउंड",
      "பவுண்டு",
      "పౌండ్",
      "ಪೌಂಡ್"
    ],
    description: "Imperial mass unit equal to ~453.6 grams. Standard sizing convention for bakery bread loaves (1 lb, 2 lb loaves) and birthday cakes."
  },
  {
    code: "oz",
    name: "Ounce",
    vernacularName: "औंस",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.0283495,
    isFixed: true,
    defaultForCommodities: [
      "imported confectionery",
      "tobacco pouches",
      "foreign infant formula",
      "gourmet baking ingredients"
    ],
    aliases: [
      "oz",
      "ounce",
      "ounces",
      "औंस",
      "அவுன்ஸ்",
      "ఔన్స్"
    ],
    description: "Imperial unit equal to ~28.35 grams, encountered in upscale urban Kiranas stocking imported packaged products."
  },
  {
    code: "mutthi",
    name: "Handful (Mutthi)",
    vernacularName: "मुट्ठी (लगभग 50g)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.05,
    isFixed: false,
    defaultForCommodities: [
      "charity grains (daan)",
      "bird feed",
      "coriander seeds",
      "whole dry red chillies",
      "peanuts"
    ],
    aliases: [
      "mutthi",
      "muthi",
      "muthiyan",
      "handful",
      "मुट्ठी",
      "मूठ",
      "ముష్టి",
      "பிடி",
      "ମୁଠା",
      "মুঠি"
    ],
    description: "Informal anthropomorphic mass unit representing an adult fistful (~50 grams). Common in rural religious charity requests, bird feed, and loose dried spices."
  },
  {
    code: "chutki",
    name: "Pinch (Chutki)",
    vernacularName: "चुटकी (लगभग 2g)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 0.002,
    isFixed: false,
    defaultForCommodities: [
      "compounded asafoetida (hing)",
      "edible food dye",
      "alum (fitkari)",
      "baking soda",
      "lime (choona)"
    ],
    aliases: [
      "chutki",
      "chutkis",
      "pinch",
      "चुटकी",
      "ചിറ്റിക",
      "சிட்டிகை",
      "చిటికెడు",
      "ಚಿಟಿಕೆ"
    ],
    description: "Sub-gram informal measure representing a finger pinch (~2 grams) used for dispensing potent compounds like hing, edible dyes, and choona."
  },
  {
    code: "bale",
    name: "Bale / Ganth",
    vernacularName: "गांठ / बेल",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 170.0,
    isFixed: false,
    defaultForCommodities: [
      "raw cotton",
      "dry red chillies (Guntur/Byadgi)",
      "jute fibre",
      "gunny bags wholesale"
    ],
    aliases: [
      "bale",
      "bales",
      "ganth",
      "gaanth",
      "गांठ",
      "गाँठ",
      "बेल",
      "బేల్",
      "ಕಟ್ಟು ಬೇಲ್"
    ],
    description: "Large compressed industrial agricultural trade unit. Standard Indian raw cotton bale is 170 kg; dry chilli bales range from 100 kg to 150 kg."
  },
  {
    code: "pote",
    name: "Pote / Poti (Western Indian Sack)",
    vernacularName: "पोते / पोती (50kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 50.0,
    isFixed: false,
    defaultForCommodities: [
      "onions (Nashik/Pune)",
      "potatoes",
      "jowar",
      "bajra",
      "wheat",
      "rice"
    ],
    aliases: [
      "pote",
      "poti",
      "potey",
      "पोते",
      "पोती",
      "पोतं",
      "પોતા"
    ],
    description: "Prominent Marathi / Western Indian term for an agricultural sack (gunny/plastic bag), universally used in Maharashtra APMC mandis (Vashi, Lasalgaon, Pune) for onions, grains, and jowar."
  },
  {
    code: "kothlo",
    name: "Kothlo / Kothli (Gujarati Sack)",
    vernacularName: "કોથળો / કોથળી (50kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 50.0,
    isFixed: false,
    defaultForCommodities: [
      "groundnut",
      "wheat",
      "castor seeds",
      "cumin",
      "coriander seeds",
      "sugar"
    ],
    aliases: [
      "kothlo",
      "kothla",
      "kothli",
      "કોથળો",
      "કોથળા",
      "કોથળી",
      "कोथलो",
      "कोथला"
    ],
    description: "Standard Gujarati trade term for a large commodity sack (50 kg) across Gujarat APMC mandis (Unjha, Gondal, Rajkot)."
  },
  {
    code: "mootai",
    name: "Mootai / Chippam (South Indian Sack)",
    vernacularName: "மூட்டை / ಮೂಟೆ / మూట (50kg)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 50.0,
    isFixed: false,
    defaultForCommodities: [
      "ponni rice",
      "toor dal",
      "urad dal",
      "jaggery blocks",
      "tamarind"
    ],
    aliases: [
      "mootai",
      "moodai",
      "muttai",
      "chippam",
      "cippam",
      "மூட்டை",
      "மூடை",
      "சிப்பம்",
      "మూట",
      "ముద్ద",
      "ಮೂಟೆ"
    ],
    description: "Primary South Indian wholesale sack unit (Tamil/Telugu/Malayalam/Kannada). Typically refers to a 50 kg gunny bag of rice, dal, or tamarind."
  },
  {
    code: "tin_mass",
    name: "15kg Tin / Pipa (Mass)",
    vernacularName: "15 किलो टिन / पीपा (वज़न)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 15.0,
    isFixed: false,
    defaultForCommodities: [
      "wholesale mustard oil (15kg)",
      "refined soybean oil (15kg tin)",
      "vanaspati ghee (15kg tin)",
      "desi ghee bulk tin"
    ],
    aliases: [
      "15kg tin",
      "15 kg tin",
      "15 kilo tin",
      "15kg pipa",
      "15 kg pipa",
      "15 kilo pipa",
      "kilo tin",
      "15 किलो टिन",
      "15 किलो पीपा",
      "15 ਕਿਲੋ ਟੀਨ",
      "15 கிலோ டின்",
      "15 కిలోల టిన్",
      "15 କିଲୋ ଟିଣ"
    ],
    description: "Standard 15 kg net mass square tin container used in wholesale APMC mandis where edible oil and vanaspati are traded strictly by mass (15kg) rather than volume (15L), preventing the ~1.35kg oil density shortfall."
  },
  {
    code: "bheli",
    name: "Bheli / Gur Block (2.5kg)",
    vernacularName: "भेली / भिल्ली (गुड़ की भेली)",
    category: "MASS",
    baseUnit: "kg",
    conversionFactor: 2.5,
    isFixed: false,
    defaultForCommodities: [
      "jaggery (gur)",
      "unrefined cane sugar",
      "palm jaggery"
    ],
    aliases: [
      "bheli",
      "bheliya",
      "bhilli",
      "gur ki bheli",
      "jaggery block",
      "भेली",
      "भिल्ली",
      "ভেলি",
      "గోలెం",
      "ಬೆಲ್ಲದ ಅಚ್ಚು",
      "ശർക്കര ഉണ്ട",
      "ଗୁଡ଼ ଭେଲି"
    ],
    description: "Traditional solid molded hemispherical block or cake of jaggery (gur) typical in UP, Bihar, Haryana, and Rajasthan mandis, standardized to a default 2.5 kg weight."
  },

  // ==========================================
  // VOLUME (Base Unit: l) - 18 Units
  // ==========================================
  {
    code: "l",
    name: "Litre",
    vernacularName: "लीटर",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "milk",
      "mustard oil",
      "refined sunflower oil",
      "soybean oil",
      "packaged drinking water",
      "kerosene",
      "floor cleaner",
      "liquid detergent"
    ],
    aliases: [
      "l",
      "ltr",
      "liter",
      "liters",
      "litre",
      "litres",
      "lt",
      "l.",
      "लीटर",
      "ली.",
      "லிட்டர்",
      "లీటరు",
      "લિટર",
      "লিটার",
      "ಲೀಟರ್",
      "ലിറ്റർ",
      "ਲੀਟਰ",
      "ଲିଟର"
    ],
    description: "Universal metric standard base unit for liquid volume across dairy, edible oils, beverages, and liquid cleaning chemicals."
  },
  {
    code: "ml",
    name: "Millilitre",
    vernacularName: "मिलीलीटर",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.001,
    isFixed: true,
    defaultForCommodities: [
      "hair oil bottles",
      "cough syrups",
      "liquid antiseptics",
      "rose water",
      "soft drink cans",
      "tetra paks",
      "eye drops",
      "flavoring essences"
    ],
    aliases: [
      "ml",
      "mls",
      "milliliter",
      "milliliters",
      "millilitre",
      "millilitres",
      "मिलीलीटर",
      "मिली.",
      "மில்லிலிட்டர்",
      "మిల్లీలీటర్",
      "મિલિલીટર",
      "মিলিমিটার",
      "ಮಿಲಿಲೀಟರ್",
      "മില്ലിലിറ്റർ"
    ],
    description: "Sub-unit of litre (1/1000th L) universally used for pharmaceutical liquids, hair oils, beverages, personal care, and flavor essences."
  },
  {
    code: "cl",
    name: "Centilitre",
    vernacularName: "सेंटीलीटर",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.01,
    isFixed: true,
    defaultForCommodities: [
      "imported cordials",
      "syrups",
      "confectionery flavour concentrates"
    ],
    aliases: [
      "cl",
      "cls",
      "centilitre",
      "centilitres",
      "सेंटीलीटर"
    ],
    description: "Metric unit equal to 10 millilitres (0.01 L), occasionally encountered on imported syrups and gourmet cordial bottles."
  },
  {
    code: "pipa",
    name: "Pipa / Square Tin (15 Litre)",
    vernacularName: "पीपा / कनस्तर (15 लीटर)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 15.0,
    isFixed: false,
    defaultForCommodities: [
      "mustard oil",
      "refined oil",
      "soybean oil",
      "groundnut oil",
      "vanaspati ghee",
      "desi ghee (bulk)",
      "palm oil"
    ],
    aliases: [
      "pipa",
      "peepa",
      "peepay",
      "pipay",
      "canister",
      "kanastar",
      "15l tin",
      "15 litre pipa",
      "15l pipa",
      "पीपा",
      "कनस्तर",
      "पीपे",
      "પિપો",
      "டின்",
      "పీపా",
      "ଟିଣ"
    ],
    description: "Standard 15 Litre square tin container used for edible oils (mustard, refined sunflower, soybean) and vanaspati ghee in volume-based trade."
  },
  {
    code: "pauwa_liquid",
    name: "Pauwa / Quarter Litre (250ml)",
    vernacularName: "पौवा / पाव लीटर (250ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.25,
    isFixed: true,
    defaultForCommodities: [
      "loose mustard oil",
      "loose dairy milk",
      "fresh juice",
      "kerosene retail"
    ],
    aliases: [
      "pauwa",
      "pauva",
      "pauwe",
      "pauwey",
      "pauve",
      "paav litre",
      "pav litre",
      "quarter bottle",
      "250ml liquid",
      "पौवा",
      "पौवे",
      "पाव लीटर"
    ],
    description: "Colloquial quarter-litre (250 ml) liquid measure used for loose mustard oil poured into customer bottles, loose milk, and local liquid supplies."
  },
  {
    code: "adha_litre",
    name: "Half Litre (500ml)",
    vernacularName: "आधा लीटर (500ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.5,
    isFixed: true,
    defaultForCommodities: [
      "packaged milk pouches (500ml)",
      "packaged water bottles",
      "hair oil bottles",
      "soft drinks",
      "edible oil mini pouches"
    ],
    aliases: [
      "adha litre",
      "aadha litre",
      "half litre",
      "half liter",
      "adha liter",
      "500ml",
      "500 ml",
      "आधा लीटर",
      "અડધો લિટર",
      "அரை லிட்டர்",
      "అర లీటరు",
      "ಅರ್ಧ ಲೀಟರ್",
      "അര ലിറ്റർ"
    ],
    description: "Half-litre (500 ml) standard packaging size for milk pouches, water bottles, and consumer soft drinks."
  },
  {
    code: "can_liquid",
    name: "Jerrycan / Plastic Can (5L - 20L)",
    vernacularName: "कैन / जरीकेन (5L - 20L)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 5.0,
    isFixed: false,
    defaultForCommodities: [
      "cooking oil (5L jar/can)",
      "refined oil 5L",
      "floor cleaner 5L",
      "commercial phenyl",
      "20L bubbletop drinking water"
    ],
    aliases: [
      "jerrycan",
      "plastic can",
      "5l can",
      "20l jar",
      "water can",
      "water jar",
      "5 litre can",
      "जरीकेन",
      "केन",
      "கேனி",
      "క్యాన్"
    ],
    description: "Molded plastic container with handle ranging from 5 Litres to 20 Litres. Standard for 5L branded cooking oils, 5L commercial cleaning fluids, and 20L water jars."
  },
  {
    code: "drum_liquid",
    name: "Wholesale Drum (200 Litre)",
    vernacularName: "ड्रम / बैरल (200L)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 200.0,
    isFixed: false,
    defaultForCommodities: [
      "palm oil wholesale",
      "crude mustard oil",
      "bulk liquid sanitizer",
      "industrial molasses",
      "cleaning liquid bulk"
    ],
    aliases: [
      "drum",
      "drums",
      "barrel",
      "barrels",
      "200l drum",
      "ड्रम",
      "बैरल",
      "பீப்பாய்",
      "డ్రమ్"
    ],
    description: "Standard industrial steel or HDPE drum holding 200 to 210 Litres, used in B2B edible oil distribution and commercial sanitizers."
  },
  {
    code: "gallon",
    name: "Gallon",
    vernacularName: "गैलन",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 3.78541,
    isFixed: true,
    defaultForCommodities: [
      "commercial paints",
      "thinners",
      "battery distilled water",
      "cleaning solvents"
    ],
    aliases: [
      "gallon",
      "gallons",
      "गैलन",
      "கேலன்",
      "గాలన్"
    ],
    description: "US liquid gallon equal to ~3.785 Litres, standard in commercial paint supplies, thinners, and industrial workshops."
  },
  {
    code: "padi",
    name: "Padi (South Indian Measure)",
    vernacularName: "படி (தென்னிந்திய அளவு)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 1.5,
    isFixed: false,
    defaultForCommodities: [
      "ponni rice",
      "paddy",
      "sesame oil (nallenai)",
      "millets",
      "pulses"
    ],
    aliases: [
      "padi",
      "padis",
      "படி",
      "పడి",
      "ಪಡಿ"
    ],
    description: "Traditional South Indian (Tamil Nadu/Andhra) cylindrical brass volume measure holding ~1.5 Litres (varying between 1.3L and 1.8L across districts)."
  },
  {
    code: "marakkal",
    name: "Marakkal (8 Padis Volume)",
    vernacularName: "மரக்கால் (8 படி)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 12.0,
    isFixed: false,
    defaultForCommodities: [
      "paddy wholesale",
      "unpolished millets",
      "rural grains"
    ],
    aliases: [
      "marakkal",
      "marakkals",
      "மரக்கால்",
      "మరక్కాల్",
      "ಮರಕ್ಕಾಲ್"
    ],
    description: "Traditional Tamil grain measure equal to 8 padis (approximately 12 Litres), used in temple land grain revenues and rural paddy harvesting."
  },
  {
    code: "nazhi",
    name: "Nazhi (Malayalam Measure)",
    vernacularName: "നാഴി (മലയാള അളവ്)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.3,
    isFixed: false,
    defaultForCommodities: [
      "kerala matta rice",
      "coconut oil",
      "millets"
    ],
    aliases: [
      "nazhi",
      "naazhi",
      "നാഴി",
      "நாழி"
    ],
    description: "Traditional Kerala volume measure roughly equal to 300 millilitres (0.3 L). Four Nazhis make one Idangazhi."
  },
  {
    code: "katori",
    name: "Katori / Small Bowl (~150ml)",
    vernacularName: "कटोरी / वाटी / বাটি (~150ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.15,
    isFixed: false,
    defaultForCommodities: [
      "curd (dahi)",
      "loose ghee",
      "sugar",
      "dal",
      "cooking oil",
      "besan"
    ],
    aliases: [
      "katori",
      "katoriyan",
      "katoris",
      "vati",
      "vaati",
      "wati",
      "baati",
      "bati",
      "कटोरी",
      "कटोरियां",
      "वाटी",
      "বাটি",
      "கிண்ணம்",
      "గిన్నె",
      "ಬಟ್ಟಲು",
      "കിണ്ണം"
    ],
    description: "Informal domestic volumetric counter measure (~150 ml) based on a traditional Indian stainless steel bowl (katori/vati), common in home retail grocery requests."
  },
  {
    code: "chammach",
    name: "Chammach / Spoon (~15ml)",
    vernacularName: "चम्मच / चमचा (~15ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.015,
    isFixed: false,
    defaultForCommodities: [
      "asafoetida (hing)",
      "turmeric powder (haldi)",
      "edible food color",
      "honey",
      "ghee",
      "churna"
    ],
    aliases: [
      "chammach",
      "chamach",
      "chamche",
      "chammachein",
      "tbsp",
      "tsp",
      "tablespoon",
      "teaspoon",
      "चम्मच",
      "चमचा",
      "चमचे",
      "चमची",
      "ચમચી",
      "கரண்டி",
      "స్పూన్",
      "ಚಮಚ",
      "സ്പൂൺ",
      "চামচ",
      "ଚାମଚ"
    ],
    description: "Informal kitchen measure (~15 ml for tablespoon / ~5 ml for teaspoon) used for dispensing small quantities of loose ground spices, coloring agents, and ayurvedic churnas."
  },
  {
    code: "cup",
    name: "Cup (~150ml)",
    vernacularName: "कप (~150ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.15,
    isFixed: false,
    defaultForCommodities: [
      "tea (chai)",
      "filter coffee",
      "hot milk",
      "loose curd",
      "baking flour"
    ],
    aliases: [
      "cup",
      "cups",
      "कप",
      "কাপ",
      "కప్పు",
      "ಕಪ್",
      "കപ്പ്",
      "କପ୍"
    ],
    description: "Colloquial retail counter measure (~150 ml) for tea stalls, local beverage dispensaries, and home-scale recipe ingredients."
  },
  {
    code: "glass",
    name: "Glass / Tumbler (~250ml)",
    vernacularName: "ग्लास / गिलास / டம்ளர் (~250ml)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 0.25,
    isFixed: false,
    defaultForCommodities: [
      "fresh milk",
      "lassi",
      "sugarcane juice",
      "loose edible oil",
      "buttermilk (chaas)"
    ],
    aliases: [
      "glass",
      "glasses",
      "gilas",
      "gilaas",
      "tumbler",
      "ग्लास",
      "गिलास",
      "டம்ளர்",
      "గ్లాసు",
      "ಲೋಟ",
      "গ্লাস",
      "ଗ୍ଲାସ"
    ],
    description: "Everyday cylindrical glass or stainless steel tumbler measure (~250 ml) used at dairy booths, juice stalls, and Kirana counters."
  },
  {
    code: "para",
    name: "Para (Kerala Grain/Liquid Measure)",
    vernacularName: "പറ (കേരള അളവ് ~12L)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 12.0,
    isFixed: false,
    defaultForCommodities: [
      "paddy (nellu)",
      "kerala matta rice",
      "coconut oil bulk",
      "unhusked grains"
    ],
    aliases: [
      "para",
      "parah",
      "paras",
      "പറ",
      "പത്ത് ഇടങ്ങഴി"
    ],
    description: "Traditional Malayalam agricultural volumetric standard equal to 10 idangazhis (~12 Litres), universally cited in Kerala paddy harvesting, temple offerings, and rice trade."
  },
  {
    code: "kuncham",
    name: "Kuncham (Andhra Grain Measure)",
    vernacularName: "కుంచం (ఆంధ్ర ధాన్యపు కొలత ~4L)",
    category: "VOLUME",
    baseUnit: "l",
    conversionFactor: 4.0,
    isFixed: false,
    defaultForCommodities: [
      "paddy",
      "sona masoori rice",
      "millets",
      "toor dal"
    ],
    aliases: [
      "kuncham",
      "kunchalu",
      "kunchams",
      "కుంచం",
      "కుంచాలు"
    ],
    description: "Traditional Andhra Pradesh and Telangana volumetric grain measure equal to 4 manikas (~4 Litres), standard in rural agricultural trade."
  },

  // ==========================================
  // COUNT & PACKAGING (Base Unit: pcs) - 36 Units
  // ==========================================
  {
    code: "pcs",
    name: "Piece / Item",
    vernacularName: "पीस / आयटम",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "chocolates",
      "coconuts",
      "toothbrushes",
      "batteries",
      "stationery",
      "pens"
    ],
    aliases: [
      "pcs",
      "piece",
      "pieces",
      "pc",
      "item",
      "items",
      "unit",
      "units",
      "पीस",
      "పీస్",
      "துண்டு",
      "পিস",
      "പീസ്"
    ],
    description: "Base atomic unit for counting discrete individual merchandise items across all retail categories."
  },
  {
    code: "packet",
    name: "Packet / Pack",
    vernacularName: "पैकेट / पैक",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "biscuits (Parle-G, Britannia)",
      "chips (Lays, Kurkure)",
      "instant noodles (Maggi)",
      "bread loaves",
      "table salt (Tata Salt 1kg)",
      "packaged spices"
    ],
    aliases: [
      "packet",
      "packets",
      "pkt",
      "pkts",
      "pack",
      "packs",
      "packeto",
      "packeton",
      "packetein",
      "पैकेट",
      "पैक",
      "पैकेटों",
      "பாக்கெட்",
      "ప్యాకెట్",
      "પેકેટ",
      "প্যাকেট",
      "ಪ್ಯಾಕೆಟ್",
      "പാക്കറ്റ്",
      "ਪੈਕੇਟ",
      "ପ୍ୟାକେଟ"
    ],
    description: "Individual sealed consumer retail packet (poly-film, foil, paper-laminate), the dominant unit of FMCG retail sales."
  },
  {
    code: "pouch",
    name: "Pouch",
    vernacularName: "पाउच",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "liquid milk (Amul, Mother Dairy 500ml)",
      "refined oil 1L pouch",
      "curd (dahi 200g/400g)",
      "tomato ketchup refills",
      "handwash refills"
    ],
    aliases: [
      "pouch",
      "pouches",
      "पाउच",
      "பவுச்",
      "పౌచ్",
      "પાઉચ",
      "পাউচ"
    ],
    description: "Flexible pillow or standee polymer pouch used for retail dairy milk, edible oil refills, liquid soaps, and condiments."
  },
  {
    code: "sachet",
    name: "Sachet (Single-Use Pouch)",
    vernacularName: "सैशे / छोटा पाउच",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "shampoo (Clinic Plus, Sunsilk ₹1/₹2)",
      "pan masala (Vimal, Kamla Pasand)",
      "antacid (Eno)",
      "instant coffee (Nescafe ₹2)",
      "hair dye (Godrej powder)",
      "tomato sauce ₹1"
    ],
    aliases: [
      "sachet",
      "sachets",
      "sacheto",
      "sacheton",
      "सैशे",
      "சாஷே",
      "శాచెట్",
      "સેશે",
      "স্যাচেট"
    ],
    description: "Miniature single-dose polymer or laminate pouch sold at low price points (₹1, ₹2, ₹5). Core high-frequency Kirana merchandise."
  },
  {
    code: "strip",
    name: "Strip / Blister Card",
    vernacularName: "स्ट्रिप / पत्ता",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 10.0,
    isFixed: false,
    defaultForCommodities: [
      "OTC medicines (Paracetamol, Disprin)",
      "throat lozenges (Strepsils, Vicks)",
      "batteries (Eveready AA/AAA blister cards)",
      "chewing gum cards"
    ],
    aliases: [
      "strip",
      "strips",
      "patta",
      "blister",
      "blister pack",
      "स्ट्रिप",
      "पत्ता",
      "மருந்து அட்டை",
      "పట్టీ",
      "స్ట్రిప్",
      "സ്ട്രൈപ്പ്"
    ],
    description: "Pharmaceutical blister or foil packaging holding a row of tablets, lozenges, or batteries (typically 10 tablets per strip)."
  },
  {
    code: "ladi",
    name: "Ladi / Hanging Streamer",
    vernacularName: "लड़ी / माला",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 12.0,
    isFixed: false,
    defaultForCommodities: [
      "shampoo sachets (16 or 24 sachets)",
      "pan masala (12 or 24 sachets)",
      "chips/snacks streamers (12 packs)",
      "Eno sachets (30 units)",
      "washing powder sachets"
    ],
    aliases: [
      "ladi",
      "ladee",
      "ladis",
      "ladiyan",
      "ladeeyan",
      "mala",
      "hang-sell",
      "streamer",
      "string",
      "लड़ी",
      "लडी",
      "लड़ियां",
      "लडियां",
      "माला",
      "ಲಡಿ"
    ],
    description: "Vertical hanging continuous chain/streamer of perforated retail sachets or snack bags designed for storefront display hooks."
  },
  {
    code: "peti",
    name: "Master Shipper / Peti",
    vernacularName: "पेटी / खोका",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 24.0,
    isFixed: false,
    defaultForCommodities: [
      "biscuits (Parle-G 72 packs)",
      "toilet soap bars (48 bars)",
      "noodles (Maggi 96 packs)",
      "cold drink pet bottles (24 bottles)",
      "packaged fruit juice"
    ],
    aliases: [
      "peti",
      "petiyan",
      "pettiyan",
      "petiya",
      "pettiya",
      "petty",
      "master carton",
      "shipper",
      "shipper carton",
      "case",
      "wooden box",
      "पेटी",
      "पेटियां",
      "खोखो",
      "ખોખું",
      "పెద్ద పెట్టె",
      "மாஸ்டர் பெட்டி",
      "ದೊಡ್ಡ ಪೆಟ್ಟಿಗೆ",
      "ਪੇਟੀ"
    ],
    description: "Wholesale master corrugated box or wooden crate from FMCG companies holding bulk inner retail units (typically 24, 48, or 72 pieces)."
  },
  {
    code: "carton",
    name: "Corrugated Carton",
    vernacularName: "कार्टन / डिब्बा",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 24.0,
    isFixed: false,
    defaultForCommodities: [
      "tetra paks (Real Fruit Juice, Frooti)",
      "breakfast cereals (Kellogg's boxes)",
      "personal care bottles",
      "tea carton packs"
    ],
    aliases: [
      "carton",
      "cartons",
      "outer box",
      "कार्टन",
      "அட்டைப்பெட்டி",
      "కార్టన్",
      "কার্টন"
    ],
    description: "Corrugated paperboard outer shipping box used by distributors to pack retail SKUs for delivery."
  },
  {
    code: "crate",
    name: "Plastic Returnable Crate",
    vernacularName: "क्रेट / जाली",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 24.0,
    isFixed: false,
    defaultForCommodities: [
      "milk pouches (Amul 24 pouches)",
      "glass cold drink bottles (Thums Up, Coca Cola 24 bottles)",
      "beer bottles",
      "tomatoes / vegetables from mandi"
    ],
    aliases: [
      "crate",
      "crates",
      "jali",
      "plastic crate",
      "milk crate",
      "क्रेट",
      "जाली",
      "கிரேட்",
      "క్రేట్"
    ],
    description: "Durable rigid plastic returnable container used in milk and cold drink distribution networks (holding 24 bottles or 24 milk pouches)."
  },
  {
    code: "dabba",
    name: "Dabba / Rigid Box / Tin",
    vernacularName: "डब्बा / डिब्बा",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: false,
    defaultForCommodities: [
      "ghee 1kg dabba",
      "sweets / mithai dabba",
      "loose candies plastic container",
      "talcum powder tins",
      "tea caddies"
    ],
    aliases: [
      "dabba",
      "dabbe",
      "dabbey",
      "dibba",
      "dibbe",
      "dibbey",
      "dibbi",
      "dibbiya",
      "dabbiyan",
      "plastic dabba",
      "tin dabba",
      "डब्बा",
      "डब्बे",
      "डिब्बा",
      "डिब्बे",
      "डिब्बी",
      "डिब्बियां",
      "ડબ્બો",
      "డబ్బాలు"
    ],
    description: "Rigid plastic, tinplate, or cardboard lidded container used for premium packaging (ghee, sweets, loose confectionery, milk powder)."
  },
  {
    code: "box",
    name: "Box",
    vernacularName: "बॉक्स",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "tea bags box",
      "corn flakes box",
      "incense sticks (agarbatti)",
      "matches outers",
      "chocolates gift pack"
    ],
    aliases: [
      "box",
      "boxes",
      "kartun",
      "khoka",
      "खोखा",
      "खोखे",
      "बॉक्स",
      "పెట్టె",
      "ಪೆಟ್ಟಿಗೆ",
      "പെട്ടി",
      "বাক্স"
    ],
    description: "Rectangular paperboard or plastic outer box housing consumer merchandise, confectionery, or stationery."
  },
  {
    code: "gaddi",
    name: "Gaddi / Tied Bundle",
    vernacularName: "गड्डी (10-20 नग)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 10.0,
    isFixed: false,
    defaultForCommodities: [
      "matchboxes (pack of 10)",
      "beedi bundles (pack of 20 or 25)",
      "student exercise notebooks (bundle of 6 or 12)",
      "currency note packs"
    ],
    aliases: [
      "gaddi",
      "gaddee",
      "gaddis",
      "गड्डी",
      "ਗੱਡੀ",
      "గడ్డి",
      "ಗಡ್ಡಿ",
      "গদ্দি"
    ],
    description: "Paper-wrapped or twine-bound bundle of flat or small retail units. Standard for matchboxes (10 matches = 1 gaddi) and beedis (20-25 per gaddi)."
  },
  {
    code: "bundle",
    name: "Bundle / Judi (Bunch)",
    vernacularName: "बंडल / जूड़ी",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: false,
    defaultForCommodities: [
      "coriander (dhaniya)",
      "spinach (palak)",
      "methi greens",
      "grass brooms (jhadu)",
      "cinnamon sticks"
    ],
    aliases: [
      "bundle",
      "bundles",
      "judi",
      "judis",
      "pendhi",
      "guccha",
      "guchha",
      "guchhe",
      "बंडल",
      "जूड़ी",
      "पेंढी",
      "गुच्छा",
      "गुच्छे"
    ],
    description: "Natural or banded bunch of fresh produce (spinach, fresh herbs) or tied non-food items like broomsticks."
  },
  {
    code: "dozen",
    name: "Dozen",
    vernacularName: "दर्जन",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 12.0,
    isFixed: true,
    defaultForCommodities: [
      "bananas",
      "poultry eggs",
      "lemons",
      "glass bangles",
      "stationery pencils",
      "handkerchiefs",
      "innerwear"
    ],
    aliases: [
      "dozen",
      "dozens",
      "darjan",
      "doz",
      "dz",
      "दर्जन",
      "டஜன்",
      "డజను",
      "ડઝન",
      "ডজন",
      "ಡಜನ್",
      "ഡസൻ",
      "ਦਰਜਨ",
      "ଡଜନ"
    ],
    description: "Standard duodecimal unit equal to exactly 12 individual items. Primary counter unit for bananas, eggs, lemons, and bangles."
  },
  {
    code: "half_dozen",
    name: "Half Dozen",
    vernacularName: "आधा दर्जन (6 नग)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 6.0,
    isFixed: true,
    defaultForCommodities: [
      "bananas",
      "eggs",
      "lemons",
      "mangoes",
      "sweet limes"
    ],
    aliases: [
      "half dozen",
      "adha darjan",
      "aadha darjan",
      "half-dozen",
      "6 pcs",
      "आधा दर्जन",
      "અડધો ડઝન",
      "அரை டஜன்",
      "అర డజను"
    ],
    description: "Six individual items or half of a dozen. Frequently requested for fresh eggs and bananas."
  },
  {
    code: "score_kori",
    name: "Score / Kori (20 Units)",
    vernacularName: "कोड़ी / कोरी (20 नग)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 20.0,
    isFixed: true,
    defaultForCommodities: [
      "pooja coconuts",
      "betel leaves (paan ke patte)",
      "paper kites (patang)",
      "clay tea cups (kulhad)",
      "earthen diyas"
    ],
    aliases: [
      "kori",
      "score",
      "kodee",
      "kodi",
      "कोड़ी",
      "कोरी",
      "કોડી",
      "কুড়ি",
      "కోడి"
    ],
    description: "Traditional vigesimal unit equal to exactly 20 items. Ubiquitous in wholesale coconut, betel leaf (paan), and festival kite markets."
  },
  {
    code: "gross",
    name: "Gross (144 Units)",
    vernacularName: "ग्रॉस (144 नग)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 144.0,
    isFixed: true,
    defaultForCommodities: [
      "matchbox master packs",
      "ballpoint pens",
      "pencils",
      "glass bangles wholesale",
      "hairpins"
    ],
    aliases: [
      "gross",
      "144 pcs",
      "ग्रॉस",
      "கிராஸ்",
      "గ్రాస్"
    ],
    description: "Wholesale count unit equal to 12 dozen (144 items). Standard packing for matchboxes, pens, and fasteners."
  },
  {
    code: "great_gross",
    name: "Great Gross (1,728 Units)",
    vernacularName: "ग्रेट ग्रॉस (1,728 नग)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1728.0,
    isFixed: true,
    defaultForCommodities: [
      "safety pins",
      "shirt buttons",
      "rubber bands bulk",
      "tailoring hooks"
    ],
    aliases: [
      "great gross",
      "12 gross",
      "ग्रेट ग्रॉस",
      "கிரேட் கிராஸ்"
    ],
    description: "Master bulk counting unit equal to 12 gross (1,728 pieces), used for hardware accessories, haberdashery, and safety pins."
  },
  {
    code: "dasta",
    name: "Dasta / Quire (24 Sheets)",
    vernacularName: "दस्ता (24 पन्ने)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 24.0,
    isFixed: true,
    defaultForCommodities: [
      "ruled exam answer sheets",
      "ledger bahi-khata loose paper",
      "craft chart papers",
      "kite tissue paper"
    ],
    aliases: [
      "dasta",
      "quire",
      "दस्ता",
      "দস্তা",
      "దిస్తా"
    ],
    description: "Traditional Indian paper measurement unit equal to 24 sheets (1/20th of a 480-sheet commercial ream)."
  },
  {
    code: "ream",
    name: "Ream (500 Sheets)",
    vernacularName: "रिम / रीम (500 पन्ने)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 500.0,
    isFixed: true,
    defaultForCommodities: [
      "A4 photocopy paper",
      "legal copier paper",
      "commercial printing paper"
    ],
    aliases: [
      "ream",
      "reams",
      "rim",
      "रिम",
      "रीम",
      "ரீம்",
      "రీమ్"
    ],
    description: "Standard industrial paper packaging unit containing exactly 500 sheets of cut office paper (A4, Legal, FS)."
  },
  {
    code: "tray",
    name: "Egg Tray (30 Eggs)",
    vernacularName: "ट्रे (30 अंडे)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 30.0,
    isFixed: false,
    defaultForCommodities: [
      "poultry farm fresh eggs",
      "bakery pav buns wholesale"
    ],
    aliases: [
      "tray",
      "trays",
      "egg tray",
      "30 eggs",
      "ट्रे",
      "டிரே",
      "ట్రే",
      "ট্রে"
    ],
    description: "Molded pulp or plastic egg carton holding exactly 30 eggs (5x6 matrix), universally traded in commercial poultry distribution."
  },
  {
    code: "bottle",
    name: "Bottle",
    vernacularName: "बोतल / शीशी",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "packaged water (Bisleri 1L)",
      "soft drinks (Maaza, Coca Cola 750ml/2L)",
      "hair oils",
      "squashes",
      "cough syrups"
    ],
    aliases: [
      "bottle",
      "bottles",
      "bottlo",
      "bottlon",
      "btl",
      "btls",
      "shishi",
      "बोतल",
      "बोतलें",
      "बोतलों",
      "शीशी",
      "பாட்டில்",
      "బాటిల్",
      "બોટલ",
      "বোতল"
    ],
    description: "Glass or rigid PET plastic bottle container with screw cap or crown cork."
  },
  {
    code: "can_pack",
    name: "Beverage / Food Can",
    vernacularName: "टिन कैन / ड्रिंक कैन",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "carbonated beverages (Coke 300ml can)",
      "energy drinks (Red Bull 250ml)",
      "canned sweets (Haldiram Gulab Jamun 1kg tin)",
      "canned fruit slices"
    ],
    aliases: [
      "can pack",
      "beverage can",
      "tin can",
      "canned food",
      "cold drink can",
      "soda can",
      "टिन कैन",
      "கேன் பேக்"
    ],
    description: "Hermetically sealed aluminum or tinplate retail can for carbonated beverages, energy drinks, and canned confectionery."
  },
  {
    code: "jar",
    name: "Jar / Barni",
    vernacularName: "जार / बरनी",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: false,
    defaultForCommodities: [
      "confectionery counter jars (Pulse toffee, Alpenliebe 150-250 toffees)",
      "pickles (Pravin, Mothers 1kg barni)",
      "peanut butter",
      "jam jars",
      "instant coffee glass jars"
    ],
    aliases: [
      "jar",
      "jars",
      "barni",
      "counter jar",
      "candy jar",
      "toffee jar",
      "जार",
      "बरनी",
      "ஜாடி",
      "జాడీ",
      "બરણી"
    ],
    description: "Wide-mouthed cylindrical glass or rigid PET jar used for counter-top impulse toffees, pickles, jams, and spreads."
  },
  {
    code: "tub",
    name: "Tub",
    vernacularName: "टब",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "butter (Amul Butter Tub 500g)",
      "margarine",
      "ice cream party tubs",
      "curd tubs"
    ],
    aliases: [
      "tub",
      "tubs",
      "टब",
      "டப்",
      "టబ్"
    ],
    description: "Shallow round or oval plastic container with snap-on lid, typical for table butter spreads and family ice cream packs."
  },
  {
    code: "roll",
    name: "Roll",
    vernacularName: "रोल",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "aluminum kitchen foil (Freshwrap)",
      "cling film",
      "baking parchment",
      "mosquito coil packs",
      "transparent adhesive tape"
    ],
    aliases: [
      "roll",
      "rolls",
      "रोल",
      "ரோல்",
      "రోల్"
    ],
    description: "Cylindrical spool or spiral continuous wrapping merchandise."
  },
  {
    code: "tube",
    name: "Tube",
    vernacularName: "ट्यूब",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "toothpaste (Colgate, Pepsodent, Sensodyne)",
      "instant adhesives (Fevikwik)",
      "skin fairness creams",
      "ointment balms"
    ],
    aliases: [
      "tube",
      "tubes",
      "ट्यूब",
      "டியூப்",
      "ట్యూబ్"
    ],
    description: "Collapsible plastic or laminated aluminum squeeze tube with dispenser nozzle."
  },
  {
    code: "nang",
    name: "Nang / Nag (Regional Piece Count)",
    vernacularName: "નંગ / नग (पीस)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "coconuts",
      "lemons",
      "mangoes",
      "sweet limes",
      "soap cakes",
      "general individual pieces"
    ],
    aliases: [
      "nang",
      "nag",
      "nangu",
      "નંગ",
      "नग",
      "నగ"
    ],
    description: "Standard regional piece counting word used across Gujarat (નંગ), Maharashtra, and Central India for individual count/pieces in APMC and retail trade."
  },
  {
    code: "kattu",
    name: "Kattu / Bunch (South India)",
    vernacularName: "கட்டு / కట్ట (Bunch / Bundle)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: false,
    defaultForCommodities: [
      "keerai (spinach)",
      "coriander greens",
      "curry leaves (kariveppilai)",
      "drumstick bundles",
      "flowers"
    ],
    aliases: [
      "kattu",
      "kattus",
      "kattulu",
      "கட்டு",
      "కట్ట",
      "ಕೆಟ್ಟು",
      "கொத்து"
    ],
    description: "Primary South Indian term (Tamil, Telugu, Kannada) for a tied bunch or bundle of fresh greens, curry leaves, and culinary herbs."
  },
  {
    code: "pudi",
    name: "Pudi / Pudiya (Small Packet/Wrap)",
    vernacularName: "पुड़ी / पुड़िया (कागज़ की पुड़िया)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "loose whole spices",
      "camphor tablets",
      "digestive churan",
      "ground tobacco",
      "pooja sindoor"
    ],
    aliases: [
      "pudi",
      "pudiya",
      "puriya",
      "poodi",
      "पुड़ी",
      "पुड़िया",
      "ಪುಡಿ",
      "పుడియ"
    ],
    description: "Traditional handmade paper fold or miniature sealed envelope used at grocery counters for dispensing minute spice quantities and camphor."
  },
  {
    code: "jodi",
    name: "Jodi / Pair (2 Units)",
    vernacularName: "जोड़ी / जोड़ा (Pair)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 2.0,
    isFixed: true,
    defaultForCommodities: [
      "chappals",
      "footwear",
      "pooja coconuts",
      "socks",
      "candles",
      "diyas",
      "bangles",
      "bananas",
      "towels"
    ],
    aliases: [
      "jodi",
      "joda",
      "jodiyan",
      "jodiya",
      "pair",
      "pairs",
      "couple",
      "जोड़ी",
      "जोड़ा",
      "जोडी",
      "जोड़ियां",
      "જોડી",
      "জোড়া",
      "জোড়া",
      "ஜோடி",
      "జత",
      "జోడి",
      "ಜೋಡಿ",
      "ഇരട്ട",
      "ଯୋଡ଼ି",
      "ਜੋੜੀ"
    ],
    description: "Count unit representing a pair (2 individual units), standard across Indian footwear, pooja rituals (coconut pair), and festive retail items."
  },
  {
    code: "bar",
    name: "Bar / Cake / Tikiya",
    vernacularName: "साबुन की टिकिया / बार / टिक्की",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "bath soap (Lux, Dettol, Lifebuoy)",
      "detergent washing bar (Rin, Wheel, Tide)",
      "dishwash bar (Vim, Exo)",
      "butter block (Amul 100g/500g)",
      "camphor cake (kapoor)",
      "jaggery cake"
    ],
    aliases: [
      "bar",
      "bars",
      "cake",
      "cakes",
      "tikiya",
      "tikki",
      "tikiyan",
      "tikkiyan",
      "साबुन बार",
      "बार",
      "टिकिया",
      "टिक्की",
      "टिक्कियां",
      "બાટી",
      "கட்டி",
      "சோப் கட்டி",
      "బిళ్ళ",
      "సబ్బు బిళ్ళ",
      "ಕೇಕ್",
      "ಸೋಪ್ ಬಾರ್",
      "കട്ട",
      "টুকরো",
      "ଖଣ୍ଡ"
    ],
    description: "Standard molded retail unit for bath soap cakes, detergent washing bars, dishwashing bars, butter blocks, and solid camphor tablets."
  },
  {
    code: "theli",
    name: "Theli / Retail Bag / Shopping Pouch",
    vernacularName: "थैली / थैला / झोला",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: false,
    defaultForCommodities: [
      "milk pouch (Amul/Mother Dairy 500ml)",
      "produce carry bag (potatoes, onions)",
      "shopping carry bag",
      "curd pouch",
      "loose small grocery purchases"
    ],
    aliases: [
      "theli",
      "theliya",
      "theliyan",
      "thaila",
      "thaile",
      "thailey",
      "jhola",
      "jhole",
      "carry bag",
      "polythene",
      "plastic bag",
      "थैली",
      "थैलियां",
      "थैला",
      "थैले",
      "झोला",
      "झोले",
      "থলে",
      "பையி",
      "ಸಂಚಿ",
      "సంచి",
      "സഞ്ചി",
      "ଝୋଲା"
    ],
    description: "Everyday retail carry bag, shopping pouch, or milk pouch term used interchangeably across North, Western, and Central India for counter sales."
  },
  {
    code: "thonga",
    name: "Thonga / Conical Paper Wrap",
    vernacularName: "ठोंगा / ঠোঙা (कागज़ की पुड़िया/थैली)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "puffed rice (muri)",
      "roasted chana",
      "loose spices",
      "jalebi",
      "sweets",
      "chanachur",
      "peanuts"
    ],
    aliases: [
      "thonga",
      "thongi",
      "thongas",
      "ठोंगा",
      "ठोंगी",
      "ঠোঙা",
      "ঠোঙ্গা",
      "କାଗଜ ଠୁଙ୍ଗା"
    ],
    description: "Traditional brown paper or newspaper cone/packet used universally across Eastern India (Bengal, Bihar, Odisha, Eastern UP) for loose dispensary of dry snacks, ground spices, and hot confectionery."
  },
  {
    code: "dona",
    name: "Dona / Leaf Bowl (Prasad Cup)",
    vernacularName: "दोना / पत्तल (पत्ते का कटोरा)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "prasad",
      "loose sweets",
      "batasha",
      "dry flowers",
      "puffed rice",
      "khoya",
      "curd"
    ],
    aliases: [
      "dona",
      "done",
      "patrawali",
      "leaf bowl",
      "दोना",
      "दोने",
      "पत्तल",
      "ঠোঙা দোনা",
      "దొన్నె",
      "தொன்னை",
      "ദോന"
    ],
    description: "Biodegradable pressed sal leaf or disposable paper bowl universally used for distributing temple prasad, batasha, curd, or sweets in kirana and religious bazaar counters."
  },
  {
    code: "gatta",
    name: "Gatta / Wholesale FMCG Bundle",
    vernacularName: "गट्टा (होलसेल कार्टन / बंडल)",
    category: "COUNT",
    baseUnit: "pcs",
    conversionFactor: 24.0,
    isFixed: false,
    defaultForCommodities: [
      "Parle-G biscuits",
      "soap cakes",
      "detergent packets",
      "matchbox outers",
      "notebooks"
    ],
    aliases: [
      "gatta",
      "gatte",
      "gattey",
      "gatta pack",
      "गट्टा",
      "गट्टे",
      "ਗੱਟਾ"
    ],
    description: "Prominent North Indian wholesale trade term (Delhi, Haryana, Western UP, Rajasthan) denoting a stiff corrugated outer carton, shrink-wrapped pack, or heavy tied packet of 12 to 24 retail units."
  },

  // ==========================================
  // LENGTH (Base Unit: m) - 8 Units
  // ==========================================
  {
    code: "m",
    name: "Metre",
    vernacularName: "मीटर",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 1.0,
    isFixed: true,
    defaultForCommodities: [
      "unstitched fabric (cloth)",
      "tarpaulin sheets (tirpal)",
      "nylon rope",
      "electrical wiring",
      "plastic garden hose",
      "binding wire",
      "ribbons"
    ],
    aliases: [
      "m",
      "meter",
      "meters",
      "metre",
      "metres",
      "mtr",
      "mtrs",
      "मीटर",
      "மீட்டர்",
      "మీటరు",
      "મીટર",
      "মিটার",
      "ಮೀಟರ್",
      "മീറ്റർ",
      "ਮੀਟਰ",
      "ମିଟର"
    ],
    description: "Universal metric standard base unit for length, distance, and linear dimensions across retail trade."
  },
  {
    code: "cm",
    name: "Centimetre",
    vernacularName: "सेंटीमीटर",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.01,
    isFixed: true,
    defaultForCommodities: [
      "tailoring elastic tape",
      "decorative lace",
      "saree border fall",
      "plastic packaging film width",
      "ribbons"
    ],
    aliases: [
      "cm",
      "cms",
      "centimeter",
      "centimeters",
      "centimetre",
      "centimetres",
      "सेंटीमीटर",
      "சென்டிமீட்டர்",
      "సెంటీమీటర్",
      "સેન્ટીમીટર",
      "সেন্টিমিটার"
    ],
    description: "Sub-unit of metre (1/100th m) used for haberdashery, narrow elastic bands, ribbons, and border fabric measurements."
  },
  {
    code: "mm",
    name: "Millimetre",
    vernacularName: "मिलीमीटर",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.001,
    isFixed: true,
    defaultForCommodities: [
      "binding wire gauge",
      "nylon twine diameter",
      "plastic bag thickness (microns)",
      "screws",
      "nails"
    ],
    aliases: [
      "mm",
      "mms",
      "millimeter",
      "millimeters",
      "मिलीमीटर",
      "மில்லிமீட்டர்",
      "మిల్లీమీటర్"
    ],
    description: "Sub-unit of metre (1/1000th m) used for measuring wire diameter, twine gauge, fastener thickness, and hardware fittings."
  },
  {
    code: "inch",
    name: "Inch",
    vernacularName: "इंच",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.0254,
    isFixed: true,
    defaultForCommodities: [
      "brown packaging tape width (2 inch)",
      "PVC pipe diameters",
      "steel nails",
      "screen mesh spacing",
      "rope thickness"
    ],
    aliases: [
      "inch",
      "inches",
      "in",
      "in.",
      "इंच",
      "இன்ச்",
      "ఇంచ్",
      "ઇંચ",
      "ইঞ্চি"
    ],
    description: "Imperial linear unit equal to 25.4 millimetres. Standard dimensioning unit for packaging tape widths (1 inch, 2 inch, 3 inch) and hardware."
  },
  {
    code: "foot",
    name: "Foot / Feet",
    vernacularName: "फुट / फीट",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.3048,
    isFixed: true,
    defaultForCommodities: [
      "plastic rope lengths",
      "tarpaulins (12x15 feet)",
      "bamboo poles",
      "hose pipe cutting",
      "electrical conduit",
      "chain link fencing"
    ],
    aliases: [
      "foot",
      "feet",
      "ft",
      "ft.",
      "फुट",
      "फीट",
      "அடி",
      "అడుగు",
      "ફૂટ",
      "ফুট",
      "ಫೀಟ್",
      "അടി"
    ],
    description: "Imperial linear measure equal to 12 inches (0.3048 metres). Primary sizing standard for ropes, hardware wires, tarpaulins, and plastic hose cutting."
  },
  {
    code: "yard",
    name: "Yard / Gaj",
    vernacularName: "गज / यार्ड",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.9144,
    isFixed: true,
    defaultForCommodities: [
      "unstitched cloth (dhotis, lungis)",
      "fencing wire",
      "traditional textile counter cuts",
      "sutli cord"
    ],
    aliases: [
      "yard",
      "yards",
      "yd",
      "yds",
      "gaj",
      "gaz",
      "गज",
      "यार्ड",
      "கஜம்",
      "గజం",
      "ગજ",
      "গজ"
    ],
    description: "Traditional Indian linear measure (Gaj) equal to exactly 3 feet (0.9144 metres or 36 inches), ubiquitous in local fabric and fencing trade."
  },
  {
    code: "haath",
    name: "Haath / Cubit",
    vernacularName: "हाथ (~0.46m)",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.4572,
    isFixed: false,
    defaultForCommodities: [
      "jute sutli (packing twine)",
      "coir rope",
      "fresh flower garlands (malli poo)",
      "bamboo fencing poles"
    ],
    aliases: [
      "haath",
      "hath",
      "cubit",
      "हाथ",
      "முழம்",
      "మూర",
      "হাত",
      "ହାତ"
    ],
    description: "Traditional anthropomorphic cubit measure spanning from the elbow to the tip of the middle finger (~18 inches or 0.457 metres). Ubiquitous in flower garland (malli poo / gajra) and rural packing rope sales."
  },
  {
    code: "bitta",
    name: "Bitta / Balisht (Handspan)",
    vernacularName: "बित्ता / बालिश्त (~0.23m)",
    category: "LENGTH",
    baseUnit: "m",
    conversionFactor: 0.2286,
    isFixed: false,
    defaultForCommodities: [
      "packing string",
      "cotton thread (sutli)",
      "craft wire",
      "narrow ribbon offcuts"
    ],
    aliases: [
      "bitta",
      "balisht",
      "span",
      "handspan",
      "बित्ता",
      "बालिश्त",
      "சாண்",
      "జాణ"
    ],
    description: "Traditional handspan measurement (~9 inches or 0.2286 metres) from thumb to little finger tip outstretched, used for casual offcuts of twine and wire."
  }
];

// Validation & Collision Detection
const validCategories = new Set(['MASS', 'VOLUME', 'COUNT', 'LENGTH']);
const validBaseUnits = new Set(['kg', 'l', 'pcs', 'm']);
const categoryBaseUnitMap = {
  MASS: 'kg',
  VOLUME: 'l',
  COUNT: 'pcs',
  LENGTH: 'm'
};

const codeSet = new Set();
let totalAliases = 0;
const categoryCounts = { MASS: 0, VOLUME: 0, COUNT: 0, LENGTH: 0 };
const fixedCounts = { fixed: 0, variable: 0 };
const aliasLookup = new Map();
const crossCollisions = [];

for (const unit of units) {
  if (!unit.code || typeof unit.code !== 'string') {
    throw new Error(`Unit missing code: ${JSON.stringify(unit)}`);
  }
  if (codeSet.has(unit.code)) {
    throw new Error(`Duplicate unit code detected: ${unit.code}`);
  }
  codeSet.add(unit.code);

  if (!unit.name) throw new Error(`Unit ${unit.code} missing name`);
  if (!unit.vernacularName) throw new Error(`Unit ${unit.code} missing vernacularName`);
  if (!validCategories.has(unit.category)) {
    throw new Error(`Unit ${unit.code} has invalid category: ${unit.category}`);
  }
  if (!validBaseUnits.has(unit.baseUnit)) {
    throw new Error(`Unit ${unit.code} has invalid baseUnit: ${unit.baseUnit}`);
  }
  if (categoryBaseUnitMap[unit.category] !== unit.baseUnit) {
    throw new Error(`Unit ${unit.code} category ${unit.category} does not match baseUnit ${unit.baseUnit}`);
  }
  if (typeof unit.conversionFactor !== 'number' || !Number.isFinite(unit.conversionFactor) || unit.conversionFactor <= 0) {
    throw new Error(`Unit ${unit.code} has invalid conversionFactor: ${unit.conversionFactor}`);
  }
  if (typeof unit.isFixed !== 'boolean') {
    throw new Error(`Unit ${unit.code} has non-boolean isFixed: ${unit.isFixed}`);
  }
  if (!Array.isArray(unit.defaultForCommodities) || unit.defaultForCommodities.length === 0) {
    throw new Error(`Unit ${unit.code} missing defaultForCommodities`);
  }
  if (!Array.isArray(unit.aliases) || unit.aliases.length === 0) {
    throw new Error(`Unit ${unit.code} missing aliases`);
  }
  if (!unit.description || typeof unit.description !== 'string') {
    throw new Error(`Unit ${unit.code} missing description`);
  }

  // De-duplicate aliases within unit
  const uniqueAliases = Array.from(new Set(unit.aliases.map(a => a.trim()).filter(Boolean)));
  unit.aliases = uniqueAliases;
  totalAliases += uniqueAliases.length;

  categoryCounts[unit.category]++;
  if (unit.isFixed) fixedCounts.fixed++;
  else fixedCounts.variable++;

  // Check cross-unit collision
  for (const a of [unit.code, ...unit.aliases]) {
    const key = a.trim().toLowerCase();
    if (aliasLookup.has(key)) {
      const existing = aliasLookup.get(key);
      if (existing !== unit.code) {
        crossCollisions.push({ alias: key, unit1: existing, unit2: unit.code });
      }
    } else {
      aliasLookup.set(key, unit.code);
    }
  }
}

console.log('=== BUILD SUMMARY ===');
console.log(`Total Units: ${units.length}`);
console.log(`Total Aliases: ${totalAliases}`);
console.log(`Unique Alias Keys: ${aliasLookup.size}`);
console.log(`Cross-Unit Collisions: ${crossCollisions.length}`);
if (crossCollisions.length > 0) {
  console.error('ERROR: Cross-unit collisions found:');
  crossCollisions.forEach(c => console.error(`  "${c.alias}": ${c.unit1} vs ${c.unit2}`));
  process.exit(1);
}

// Write the generated unitDictionary.json
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(units, null, 2), 'utf-8');
console.log(`Successfully generated: ${outputPath}`);
console.log(`Categories:`, categoryCounts);
console.log(`Fixed vs Variable:`, fixedCounts);
