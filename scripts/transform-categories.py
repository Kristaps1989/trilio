#!/usr/bin/env python3
"""One-off transform applying docs/QUESTION_REVIEW.md to data/categories.json.

Kept in the repo so the change is reviewable and repeatable. Run with
`python3 -I scripts/transform-categories.py`. Idempotent: a second run on
already-transformed data makes no changes.

Schema additions (documented in docs/QUESTION_SCHEMA.md):
  question.type        "single" (default) | "multi" | "number"
  question.max_select  for multi
  question.showIf      {"q": <question id>, "in": [...]} or {"q": ..., "notIn": [...]}
  question.help        text shown when the user taps "Nezinu"
  question.input       {min, max, default, unit} for number questions
  option.passthrough   true → never filters, adds no score ("Nezinu", "Nav svarīgi")
  option.exclusive     true → in a multi question, clears the other picks
  option.implies       {<question id>: <value>} answers hidden questions
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "data" / "categories.json"


def opt(value, label, sublabel=None, card_reason=None, table_value=None, **extra):
    o = {"value": value, "label": label, "sublabel": sublabel, "card_reason": card_reason, "table_value": table_value}
    o.update(extra)
    return o


def q(id_, title, options, why=None, hard=False, **extra):
    d = {"id": id_, "title": title, "why": why, "hard_filter": hard, "options": options}
    d.update(extra)
    return d


ANY = lambda label="Nav svarīgi": opt("any", label, passthrough=True)  # noqa: E731


def find(sub, qid):
    for x in sub["questions"]:
        if x["id"] == qid:
            return x
    raise KeyError(f"{sub['id']}.{qid}")


def find_opt(question, value):
    for o in question["options"]:
        if o["value"] == value:
            return o
    raise KeyError(f"{question['id']}.{value}")


def mark_passthrough(sub):
    """Cross-cutting rule 1: 'any' / 'Nezinu' options never filter."""
    for x in sub["questions"]:
        for o in x["options"]:
            if o["value"] == "any" or o["label"] in ("Nezinu", "Nav svarīgi"):
                o["passthrough"] = True


def insert_after(sub, after_id, question):
    qs = sub["questions"]
    if any(x["id"] == question["id"] for x in qs):
        return
    idx = next(i for i, x in enumerate(qs) if x["id"] == after_id)
    qs.insert(idx + 1, question)


def insert_first(sub, question):
    if any(x["id"] == question["id"] for x in sub["questions"]):
        return
    sub["questions"].insert(0, question)


def transform(data):
    subs = {s["id"]: s for g in data["groups"] for s in g["subcategories"]}

    # ---------------- fridge (bespoke → data) ----------------
    fridge = subs["fridge"]
    fridge["custom_flow"] = False
    fridge["budget_steps_eur"] = [500, 800, 1200]
    fridge["compare_row_labels"] = ["Izmēri", "Tilpums", "Energoklase", "Trokšņa līmenis", "No Frost", "Saldētava"]
    fridge["questions"] = [
        q("type", "Kāds ledusskapis tev vajadzīgs?", [
            opt("builtin", "Iebūvējams", "slēpjas aiz virtuves skapja durvīm", "Iebūvējams — der standarta nišai", "Iebūvējams"),
            opt("free", "Brīvi stāvošs", "stāv atsevišķi, redzams", None, "Brīvi stāvošs"),
        ], hard=True, help="Iebūvējams ledusskapis ir paslēpts aiz virtuves mēbeļu durvīm un tam priekšā ir tāda pati fasāde kā skapjiem. Brīvi stāvošs ledusskapis redzams pilnībā un to var pārvietot."),
        q("niche", "Cik augsta ir niša?", [], why="Nepareizs nišas augstums ir biežākais iemesls, kāpēc iebūvējamos ledusskapjus atgriež veikalā. Izmēri centimetros parasti norādīti skapja iekšpusē vai virtuves projektā.",
          hard=True, type="number", showIf={"q": "type", "in": ["builtin"]},
          input={"min": 80, "max": 220, "default": 178, "unit": "cm", "step": 1}),
        q("size", "Cik liels ledusskapis der tavā virtuvē?", [
            opt("compact", "Kompakts", "~85 cm augsts, zem virsmas", "Kompakts — ietilpst zem virsmas", "Kompakts (~85 cm)"),
            opt("mid", "Vidējs", "~145–175 cm augsts", None, "Vidējs (145–175 cm)"),
            opt("tall", "Augsts", "~180–205 cm augsts", "Augsts — lielāks tilpums tajā pašā platumā", "Augsts (180–205 cm)"),
            opt("wide", "Plats", "80–90 cm, Side-by-Side vai French Door — pārbaudi, vai izies pa durvīm", "Plats — Side-by-Side vai French Door", "Plats (80–90 cm)"),
        ], why="Platumu nejautājam — gandrīz visi ledusskapji ir 60 cm plati. Augstums un tips nosaka, vai ledusskapis iederēsies.", hard=True, showIf={"q": "type", "in": ["free"]}),
        q("height_limit", "Vai augstums ir ierobežots?", [
            opt("le186", "Jā, līdz 186 cm", "piemēram, zem skapīša vai zema griesta", "Augstums līdz 186 cm", "≤ 186 cm"),
            opt("nolimit", "Nē, augstums nav ierobežots", None, None, None, passthrough=True),
        ], hard=True, showIf={"q": "size", "in": ["tall"]}),
        q("freezer", "Vai vajag saldētavu?", [
            opt("yes", "Jā, ar saldētavu", "kombinētais ledusskapis", "Ar saldētavu", "Ir"),
            opt("no", "Nē, tikai ledusskapis", "saldētava jau ir vai nav vajadzīga", "Bez saldētavas — vairāk vietas dzesēšanai", "Nav"),
        ], hard=True, showIf={"q": "size", "notIn": ["wide"]}),
        q("household", "Cik cilvēku ir tavā mājsaimniecībā?", [
            opt("2", "1–2", "pietiek ar ~200 L", "Tilpums ap 200 L — pietiek 1–2 cilvēkiem", "~200 L"),
            opt("4", "3–4", "ieteicams ~300 L", "Tilpums ap 300 L — pietiek ģimenei", "~300 L"),
            opt("5", "5 vai vairāk", "ieteicams 380 L un vairāk", "Liels tilpums — 380 L un vairāk", "380 L+"),
        ], why="No tā atkarīgs ieteicamais tilpums. Par mazu ledusskapi ir biežākā sūdzība pēc pirkuma."),
        q("priorities", "Kas tev ir svarīgākais?", [
            opt("quiet", "Klusums", "ja virtuve savienota ar dzīvojamo istabu", "Kluss — 38 dB vai mazāk"),
            opt("energy", "Zems elektrības patēriņš", "mazāki rēķini 10 gadu garumā", "Zems patēriņš — ietaupa uz elektrību"),
            opt("nofrost", "No Frost", "nav jāatkausē", "No Frost — nav jāatkausē"),
            opt("volume", "Liels tilpums", None, "Lielāks tilpums nekā citiem tāda paša izmēra"),
            opt("price", "Zemākā cena", None, None),
        ], type="multi", max_select=2),
    ]

    # ---------------- freezer ----------------
    fz = subs["freezer"]
    insert_after(fz, "g0", q("niche", "Cik augsta ir niša?", [], why="Nepareizs nišas augstums ir biežākais iemesls, kāpēc iebūvējamās saldētavas atgriež veikalā.",
                              hard=True, type="number", showIf={"q": "g0", "in": ["builtin"]},
                              input={"min": 80, "max": 220, "default": 178, "unit": "cm", "step": 1}))
    g1 = find(fz, "g1")
    g1["hard_filter"] = True
    g1["why"] = "Neapsildītā telpā der tikai saldētavas ar klimata klasi SN vai SN-T — citas zemā temperatūrā pārstāj saldēt."
    find_opt(g1, "home")["passthrough"] = True

    # ---------------- washer ----------------
    w = subs["washer"]
    find(w, "g2")["showIf"] = {"q": "g0", "notIn": ["top"]}
    insert_after(w, "g2", q("priorities", "Kas tev ir svarīgākais?", [
        opt("quiet", "Klusums", "ja mašīna stāv blakus guļamistabai vai virtuvē", "Klusa centrifūga — 72 dB vai mazāk"),
        opt("energy", "Zems elektrības un ūdens patēriņš", None, "Energoklase A — zemāki rēķini"),
        opt("fast", "Ātras programmas", "izmazgā 15–30 minūtēs", "Ātrā programma — līdz 30 minūtēm"),
        opt("steam", "Tvaiks pret alerģijām un smakām", None, "Tvaika programma — pret alergēniem un smakām"),
    ], type="multi", max_select=2))

    # ---------------- iron ----------------
    ir = subs["iron"]
    ir["questions"] = [x for x in ir["questions"] if x["id"] not in ("g2", "water")]
    ir["questions"].append(q("water", "Vai ūdens tavās mājās ir ciets?", [
        opt("hard", "Jā, veidojas kaļķakmens", "tējkannā paliek balts nosēdums", "Pretkaļķu sistēma — der cietam ūdenim", "Pretkaļķu sistēma"),
        opt("soft", "Nē, mīksts", None, None, None, passthrough=True),
        opt("any", "Nezinu", None, None, None, passthrough=True),
    ], why="Kaļķakmens ir galvenais iemesls, kāpēc gludekļi sabojājas. Cietam ūdenim vajag pretkaļķu sistēmu vai izņemamu kaļķa savācēju."))
    ir["compare_row_labels"] = ["Veids", "Piemērots", "Pretkaļķu sistēma"]

    # ---------------- dishwasher ----------------
    d = subs["dish"]
    find(d, "g1")["showIf"] = {"q": "g0", "notIn": ["compact"]}
    g2 = find(d, "g2")
    g2["type"] = "multi"
    g2["max_select"] = 2
    if not any(o["value"] == "energy" for o in g2["options"]):
        g2["options"] += [
            opt("energy", "Zems elektrības un ūdens patēriņš", None, "Energoklase A vai B — zemāki rēķini"),
            opt("third", "Trešā atvilktne galda piederumiem", "atbrīvo vietu apakšējā grozā", "Trešā atvilktne galda piederumiem"),
        ]

    # ---------------- hob ----------------
    h = subs["hob"]
    find(h, "g0")["title"] = "Kādu plīti vai virsmu meklē?"
    insert_after(h, "g0", q("width", "Cik plata ir vieta plītij?", [
        opt("50", "50 cm", "šaura, vecākām virtuvēm", "Platums 50 cm — der šaurai vietai", "50 cm"),
        opt("60", "60 cm", "standarta", None, "60 cm"),
        ANY("Nezinu"),
    ], why="Brīvi stāvošas plītis ir 50 vai 60 cm platas. Izmēri par centimetru lielāki neiederēsies.", hard=True, showIf={"q": "g0", "in": ["standalone"]}))
    insert_after(h, "width", q("gas", "Kāda gāze tev ir?", [
        opt("natural", "Dabasgāze", "no centralizētā tīkla", None, "Dabasgāze"),
        opt("bottle", "Balonu gāze (propāns)", "ārpus pilsētas, vasarnīcā", "Komplektā sprauslas balonu gāzei", "Balonu gāze"),
        ANY("Nezinu"),
    ], why="Dabasgāzei un balonu gāzei vajag dažādas sprauslas. Ja komplektā nav īsto, plīts nestrādās pareizi.", showIf={"q": "g0", "in": ["gas"]}))
    g2 = find(h, "g2")
    g2["showIf"] = {"q": "g0", "in": ["induction", "ceramic"]}
    g2["why"] = "Pilnas jaudas indukcijas vai keramiskajai virsmai bieži vajag 7,4 kW, ko dod tikai trīsfāzu pieslēgums. Daudzas virsmas var ierobežot jaudu vienfāzes pieslēgumam. Ja neesi pārliecināts, pajautā elektriķim."
    find_opt(g2, "n")["card_reason"] = "Ir jaudas ierobežošanas režīms vienfāzes pieslēgumam"
    find_opt(g2, "y")["passthrough"] = True

    # ---------------- oven ----------------
    o = subs["oven"]
    insert_first(o, q("niche", "Kāda ir niša cepeškrāsnij?", [
        opt("std", "Standarta 60 × 60 cm", "visizplatītākā", None, "60 × 60 cm"),
        opt("compact", "Kompakta — 45 cm augsta", "zem virsmas vai kolonnā virs mikroviļņu krāsns", "Kompakta 45 cm — der zemai nišai", "45 cm augsta"),
        opt("wide", "Plata — 90 cm", None, "Plata 90 cm — lieliem cepešiem", "90 cm plata"),
        ANY("Nezinu"),
    ], why="Nepareizs nišas izmērs ir galvenais iemesls, kāpēc cepeškrāsnis atgriež veikalā. Izmēri parasti norādīti virtuves projektā vai uz vecās krāsns uzlīmes.", hard=True))
    # Fold the standalone Wi-Fi screen into a priorities multi-select next to steam.
    o["questions"] = [x for x in o["questions"] if x["id"] not in ("g0", "g2", "priorities")]
    o["questions"].append(q("priorities", "Kas tev ir svarīgākais?", [
        opt("steam", "Tvaika atbalsts", "sulīgāka gaļa, kraukšķīga maizes garoza", "Tvaika atbalsts — sulīgāka gaļa, labāka maize"),
        opt("wifi", "Vadība ar telefonu", None, "Vadāma ar lietotni (Wi-Fi)"),
        opt("volume", "Liels tilpums (70 L un vairāk)", "lieliem cepešiem un vairākām paplātēm", "Liels tilpums — 70 L un vairāk"),
        opt("energy", "Zems elektrības patēriņš", None, "Energoklase A — zemāks patēriņš"),
    ], type="multi", max_select=2))
    o["compare_row_labels"] = ["Nišas izmērs", "Tīrīšana", "Tvaika funkcija", "Vadība ar telefonu"]

    # ---------------- hood ----------------
    hd = subs["hood"]
    g1 = find(hd, "g1")
    if not any(x["value"] == "50" for x in g1["options"]):
        g1["options"].insert(0, opt("50", "50 cm", "vecākām virtuvēm", "Platums 50 cm", "50 cm"))
        g1["options"].append(ANY("Nezinu"))
    insert_after(hd, "g2", q("openplan", "Vai virtuve ir savienota ar dzīvojamo istabu?", [
        opt("yes", "Jā", "troksnis traucēs arī citiem", "Kluss darbībā — piemērots atvērtai virtuvei"),
        opt("no", "Nē, virtuve ir atsevišķa", None, None, None, passthrough=True),
    ], why="Troksnis ir biežākā sūdzība par nosūcējiem. Atvērtā virtuvē ieteicams modelis, kas maksimālajā režīmā nepārsniedz 60 dB."))
    hd["compare_row_labels"] = ["Uzstādīšana", "Platums", "Režīms", "Trokšņa līmenis"]

    # ---------------- microwave ----------------
    m = subs["micro"]
    find_opt(find(m, "g1"), "heat")["passthrough"] = True  # heating is the minimum every microwave has

    # ---------------- vacuum (bespoke → data) ----------------
    v = subs["vacuum"]
    v["custom_flow"] = False
    v["budget_steps_eur"] = [150, 300, 600]
    v["compare_row_labels"] = ["Tips", "Darbības laiks", "Trokšņa līmenis", "Mazgāšana", "Birste dzīvniekiem"]
    v["questions"] = [
        q("type", "Kādu putekļsūcēju meklē?", [
            opt("robot", "Robotu", "tīra pats pēc grafika", "Robots — tīra pats pēc grafika", "Robots"),
            opt("stick", "Vertikālo bezvadu", "viegls, vienmēr pa rokai", "Bezvadu — viegls un ātri pa rokai", "Vertikālais"),
            opt("corded", "Klasisko ar vadu", "jaudīgākais, bez akumulatora", "Ar vadu — nemainīga jauda bez lādēšanas", "Klasiskais"),
        ], hard=True),
        q("bag", "Ar maisiņu vai bez?", [
            opt("bag", "Ar maisiņu", "putekļi paliek noslēgti, maisiņi maksā ~5 € gadā", "Ar maisiņu — putekļi paliek noslēgti", "Ar maisiņu"),
            opt("cyclone", "Bez maisiņa (ciklonisko)", "nav jāpērk maisiņi, tvertne jāiztukšo", "Bez maisiņa — nav jāpērk maisiņi", "Ciklonisks"),
            ANY(),
        ], showIf={"q": "type", "in": ["corded"]}),
        q("mop", "Vai robotam jāmazgā arī grīda?", [
            opt("yes", "Jā, arī jāmazgā", "ar ūdens tvertni un lupatiņu", "Arī mazgā grīdu", "Mazgā"),
            opt("no", "Nē, tikai jāsūc", None, None, None, passthrough=True),
        ], hard=True, showIf={"q": "type", "in": ["robot"]}),
        q("area", "Cik lielu platību tīrīsi?", [
            opt("50", "Līdz 50 m²", "dzīvoklis", None, "≤ 50 m²"),
            opt("100", "50–100 m²", None, "Darbības laiks pietiek 50–100 m²", "50–100 m²"),
            opt("150", "Vairāk nekā 100 m²", "māja vairākos stāvos", "Ilgs darbības laiks — pietiek lielai mājai", "> 100 m²"),
        ], why="Pēc tā pārbaudām, vai akumulatora darbības laiks pietiek vienai tīrīšanas reizei."),
        q("floors", "Kādas grīdas tev ir?", [
            opt("hard", "Cietas", "parkets, flīzes, lamināts", "Mīksta birste cietām grīdām", "Cietas"),
            opt("carpet", "Daudz paklāju", None, "Spēcīga sūkšana paklājiem", "Paklāji"),
            opt("mixed", "Jauktas", None, "Automātiski pielāgojas grīdas veidam", "Jauktas"),
        ]),
        q("home", "Vai mājās ir mājdzīvnieki vai alerģijas?", [
            opt("pets", "Mājdzīvnieki", "kas met spalvu", "Birste dzīvnieku spalvām", "Mājdzīvnieki"),
            opt("allergy", "Alerģijas", None, "HEPA filtrs — aiztur alergēnus", "Alerģijas"),
            opt("none", "Nekas no tā", None, None, None, passthrough=True, exclusive=True),
        ], type="multi", max_select=2),
        q("priorities", "Kas tev ir svarīgākais?", [
            opt("quiet", "Klusums", None, "Kluss — 70 dB vai mazāk"),
            opt("runtime", "Ilgs darbības laiks", None, "Ilgs darbības laiks ar vienu uzlādi"),
            opt("suction", "Sūkšanas jauda", None, "Augsta sūkšanas jauda"),
            opt("light", "Mazs svars", "viegli pacelt un nest", "Viegls — ērti nest pa kāpnēm"),
            opt("price", "Zemākā cena", None, None),
        ], type="multi", max_select=2),
    ]

    # ---------------- coffee: type first ----------------
    c = subs["coffee"]
    order = {"g1": 0, "g0": 1, "g2": 2}
    c["questions"].sort(key=lambda x: order.get(x["id"], 99))

    # ---------------- grinder: espresso implies burr ----------------
    gr = subs["grinder"]
    g0 = find(gr, "g0")
    find_opt(g0, "espresso")["implies"] = {"g1": "burr"}
    find(gr, "g1")["showIf"] = {"q": "g0", "notIn": ["espresso"]}
    g0["why"] = "Espresso vajag ļoti smalku un vienmērīgu malumu, ko dod tikai dzirnaviņas ar dzirnakmeņiem — tāpēc espresso cienītājiem rādām tikai tās."

    # ---------------- kettle: material instead of design ----------------
    k = subs["kettle"]
    g0 = find(k, "g0")
    g0["options"] = [x for x in g0["options"] if x["value"] != "design"]
    if not any(x["value"] == "glass" for x in g0["options"]):
        g0["options"] += [
            opt("glass", "Stikla korpuss", "redzams ūdens līmenis", "Stikla korpuss", "Stikls"),
            opt("steel", "Nerūsējošā tērauda korpuss", "izturīgs, bez plastmasas garšas", "Tērauda korpuss — bez plastmasas saskares ar ūdeni", "Tērauds"),
        ]
    g0["type"] = "multi"
    g0["max_select"] = 2
    k["compare_row_labels"] = ["Priekšrocības", "Materiāls", "Tilpums"]

    # ---------------- toaster: long slot instead of design ----------------
    t = subs["toaster"]
    g1 = find(t, "g1")
    g1["options"] = [x for x in g1["options"] if x["value"] != "design"]
    if not any(x["value"] == "long" for x in g1["options"]):
        g1["options"].insert(1, opt("long", "Garas atveres", "mājās ceptai maizei un lielām šķēlēm", "Garas atveres — der lielām šķēlēm", "Garas atveres"))

    # ---------------- sandwich: how many at once ----------------
    s = subs["sandwich"]
    insert_after(s, "g0", q("count", "Cik sviestmaizes vienlaikus?", [
        opt("2", "2", "1–2 cilvēkiem", None, "2"),
        opt("4", "4", "ģimenei", "4 sviestmaizes vienlaikus", "4"),
    ]))
    s["compare_row_labels"] = ["Funkcijas", "Vienlaikus"]

    # ---------------- juicer: what will be juiced ----------------
    j = subs["juicer"]
    insert_after(j, "g0", q("produce", "Ko spiedīsi visbiežāk?", [
        opt("hard", "Cietus augļus un dārzeņus", "āboli, burkāni, bietes", "Tiek galā ar cietiem augļiem un dārzeņiem", "Cieti augļi"),
        opt("greens", "Lapu zaļumus un ogas", "spināti, kāposti, upenes", "Izspiež arī lapu zaļumus", "Zaļumi"),
        ANY("Visu"),
    ], why="Lēngaitas spiedes labāk tiek galā ar zaļumiem, centrbēdzes — ar cietiem augļiem."))
    j["compare_row_labels"] = ["Tips", "Piemērots"]

    for sub in subs.values():
        mark_passthrough(sub)
        for x in sub["questions"]:
            x.setdefault("type", "single")

    data["note"] = (
        "Kategoriju koks, jautājumi un atbilžu varianti. hard_filter=true — atbilde izslēdz preces, kas tai ir pretrunā; "
        "citādi tā tikai paaugstina vērtējumu. Varianti ar passthrough=true neko neizslēdz un nepaaugstina. showIf nosaka, "
        "kad jautājums tiek rādīts. Shēma: docs/QUESTION_SCHEMA.md. Izmaiņu pamatojums: docs/QUESTION_REVIEW.md."
    )
    return data


def main():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    data = transform(data)
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("changed" if before != after else "no changes", file=sys.stderr)


if __name__ == "__main__":
    main()
