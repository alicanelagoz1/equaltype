import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

@dataclass
class Match:
    start: int
    end: int
    text: str

# --- Basic helpers ---
SENTENCE_END_RE = re.compile(r"([.!?]+|\n)$")

# İnsan/grup hedefini yakalamak için EN/TR basit kelime listeleri (MVP)
# Bunu zamanla büyüteceğiz ama MVP'de küçük tutmak false positive'i azaltır.
TARGET_TERMS_EN = {
    "women","woman","men","man","girls","boys","people","person",
    "immigrants","immigrant","refugees","refugee","muslims","muslim","christians","christian",
    "jews","jew","gay","lesbian","trans","black","white","asian","african","european",
    "disabled","autistic"
}
TARGET_TERMS_TR = {
    "kadın","kadınlar","erkek","erkekler","kız","kızlar","oğlan","oğlanlar","insan","insanlar",
    "göçmen","göçmenler","mülteci","mülteciler","müslüman","müslümanlar","hristiyan","hristiyanlar",
    "yahudi","yahudiler","eşcinsel","trans","siyah","beyaz","engelli","otistik"
}

# “Eleme / sadece / istemiyoruz” gibi ayrımcı erişim kalıpları (job/housing/service)
EXCLUSION_PATTERNS = [
    re.compile(r"\b(no|not)\s+(allowed|welcome)\b", re.I),
    re.compile(r"\bonly\s+([a-z]+)\b", re.I),
    re.compile(r"\bwe\s+don['’]?t\s+(hire|accept|serve)\b", re.I),
    re.compile(r"\bsadece\s+\w+\b", re.I),
    re.compile(r"\b(istemiyoruz|kabul etmiyoruz|almıyoruz)\b", re.I),
    
]
NORMATIVE_RESTRICTION_PATTERNS = [
    # "X should not be ..." / "X shouldn't be ..." / "X must not be ..."
    re.compile(r"\b(should\s+not|shouldn['’]?t|must\s+not|mustn['’]?t|cannot|can['’]?t)\b", re.I),
    # "X are not allowed to ..." / "X are not welcome ..."
    re.compile(r"\b(not\s+allowed|not\s+welcome)\b", re.I),
]


# Genelleme / stereotip (cümle düzeyi)
GENERALIZATION_PATTERNS = [
    re.compile(r"\b(all|every)\s+([a-z]+)\s+(are|is)\b", re.I),
    re.compile(r"\b([a-z]+)\s+(are|is)\s+(always|never)\b", re.I),
    re.compile(r"\b(tüm|bütün)\s+\w+\s+(hep|daima)\b", re.I),
    re.compile(r"\b(\w+ler|\w+lar)\s+hep\b", re.I),
]

# “Hard list” — açık hakaret / slur vb. (örnek yer tutucu)
# Burayı MVP’de ÇOK küçük tut (false positive’i azaltır).
# Not: Buraya gerçek slur’ları yazmak yerine prod’da private file/DB kullanmanı öneririm.
HARD_OFFENSIVE = {
    "nigger",
    "niggers",
}


# Marka/ürün ismi gibi false positive üretme riski olan bazı kelimeler (MVP)
# İleride NER ile gelişir; şimdilik basit koruma.
SAFE_ENTITIES = {"apple", "samsung", "google", "microsoft"}

def find_word_boundaries(text: str, term: str) -> List[Match]:
    # kelime sınırıyla ara (term'i regex escape)
    pattern = re.compile(rf"\b{re.escape(term)}\b", re.I)
    matches = []
    for m in pattern.finditer(text):
        matches.append(Match(m.start(), m.end(), text[m.start():m.end()]))
    return matches

def detect_targets(text: str) -> List[Match]:
    lowered = text.lower()
    targets: List[Match] = []

    # SAFE_ENTITIES kapısı: Apple gibi kelimeler "target" sayılmasın
    for ent in SAFE_ENTITIES:
        # ent varsa bile target algılamasın diye sadece filter mantığı aşağıda yapılacak
        pass

    # İngilizce hedef terimler
    for term in TARGET_TERMS_EN:
        # "black" hedef kelime olabilir ama renk olarak da geçebilir -> gate later
        targets.extend(find_word_boundaries(text, term))

    # Türkçe hedef terimler
    for term in TARGET_TERMS_TR:
        targets.extend(find_word_boundaries(text, term))

    # SAFE_ENTITIES geçen target match’lerini çıkar
    filtered = []
    for t in targets:
        if t.text.lower() in SAFE_ENTITIES:
            continue
        filtered.append(t)
    return filtered

def looks_like_color_usage(text: str, match: Match) -> bool:
    """
    'black' kelimesi renk olarak mı kullanılmış?
    Çok basit MVP heuristiği: black + (screen/car/background/coffee/shirt...) gibi objeler.
    """
    window = text[max(0, match.start-25):min(len(text), match.end+25)].lower()
    color_objects = ["screen","background","car","shirt","dress","color","coffee","box","logo","wall","theme"]
    return any(obj in window for obj in color_objects)

def is_sentence_completed(text: str) -> bool:
    return bool(SENTENCE_END_RE.search(text.strip()))
