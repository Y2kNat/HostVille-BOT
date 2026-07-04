// Palavras curtas sensíveis (verificadas com regex anti-circumvention)
const shortSensitiveWords = ["cu", "ku", "bct", "ppk", "fdp", "vsf", "tnc", "pqp"];

// Lista completa de palavras ofensivas
const defaultOffensiveWords = [
    // PALAVRAS BASE
    "idiota", "burro", "estupido", "retardado", "lixo",
    "merda", "fdp", "otario", "desgracado",
    "vtnc", "imbecil", "inutil", "arrombado", "viado", "bicha", 
    "piranha", "prostituta", "corno", "babaca", "palhaco", "nojento", 
    "escroto", "cretino", "canalha", "maldito", "peste", 
    "trouxa", "otaria", "burra", "cacete", "caralho", "merdinha",
    "vagabundo", "vagabunda", "cuzao", "idiotinha", "fodido", "bosta",
    "porra", "prr", "poha", "krl", "krlh", "caramba",
    "fds", "foda", "fudeu", "fodase", "fodassi",
    "pqp", "puta", "vsf", "tnc", "tmnc", "cuzão", "cú", "cu",
    "buceta", "bct", "xota", "xoxota", "ppk", "perereca",
    "rapariga", "putinha", "putona", "puto", "bosta", "bostinha", 
    "inutel", "burrinho", "estupida", "retardada", "nojenta", 
    "escrota", "trouxinha", "verminoso", "pestinha", "cretina", "maldita",
    "corninho", "chifrudo", "vagaba", "piriguete", "viadinho", "boiola", 
    "bichinha", "baitola", "sapatão",  
    "anta", "besta", "bocó", "boçal", "bronco",  
    "analfabeto", "pilantra", "malandro", "safado", "tarado", 
    "pervertido", "depravado", "asqueroso", "repugnante",  
    "feio", "crápula", "miseravel", "nulo", 
    "aborto", "lixinho", "traste", "praga", "desgraça", "fudido", 
    "danado", "capeta", "demonio", "diabo", 
    "satanás", "lucifer", "abominavel", 
    "marginal", "delinquente", "criminoso", "bandido", "ladrão", 
    "assaltante", "golpista", "enganador", "trapaceiro", "manipulador", 
    "abusador", "abusado", "folgado", "atrevido", "arrogante", 
    "pretensioso", "metido", "convencido", "soberbo",  
    "vaidoso", "futil", "birrento", "pentelho", 
    "maçante", "enfadonho", "mrd", "fodendo", "fudendo", "crl", 
    "crlh", "putaria", "puteiro", "caraio", "karaio", "carai", "karai", "vsfd",
    // PALAVRAS CURTAS E VARIAÇÕES
    "cuzinho", "cuzuda", "cuzudo", "cool", "ku", "koo", "kuzinho", "kuzão", "kuzao",
    "qoo", "qu", "fiofó", "fiofo", "toba", "rabao", "raba", "brioco",
    "olho do cool", "olho do ku", "tomar no cu", "tomar no ku", "tomar no cool",
    "seu cu", "seu ku", "seu cool", "seu cuzinho",
    // FRASES
    "vai tomar no cu", "vai tnc", "vai tmnc",
    "vai se foder", "vai se fuder", "vsf",
    "foda se", "fodase", "foda-se",
    "puta que pariu", "puta q pariu",
    "filho da puta", "filha da puta"
];

// Regex para anti-link
const inviteRegex = /(discord\.(gg|com\/invite|me)\/[a-zA-Z0-9\-]+)/gi;
const urlRegex = /(https?:\/\/[^\s]+)/gi;

module.exports = { defaultOffensiveWords, shortSensitiveWords, inviteRegex, urlRegex };