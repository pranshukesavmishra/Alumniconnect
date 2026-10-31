import json
p = "scripts/guide/narration.json"
n = json.load(open(p))
n["en"][2] = "To join the Grand Reunion, tap Register. Choose your ticket: two thousand five hundred rupees for 26 December, now 25 percent off. Add the optional 27 December tour, six hundred and fifty rupees a person. Then pay by U P I, and enter the twelve digit reference."
n["text_en"][2] = "To join the Grand Reunion, tap Register. Choose your ticket: ₹2,500 for 26 December, now 25% off. Add the optional 27 December tour, ₹650 a person. Then pay by UPI and enter the 12-digit reference."
n["en"][5] = "Share photos and videos from the event: open Menu, Reunion photos and videos, then Add photos and videos."
n["text_en"][5] = "Share photos and videos from the event: open Menu, Reunion photos & videos, then Add photos & videos."
n["hi"][2] = "ग्रैंड रीयूनियन के लिए रजिस्टर दबाइए। अपना टिकट चुनिए: छब्बीस दिसंबर के लिए ढाई हज़ार रुपये, अब पच्चीस प्रतिशत छूट पर। सत्ताईस दिसंबर का टूर वैकल्पिक है, छह सौ पचास रुपये प्रति व्यक्ति। फिर यू पी आई से भुगतान करके, बारह अंकों का रेफ़रेंस नंबर डालिए।"
n["text_hi"][2] = "ग्रैंड रीयूनियन के लिए रजिस्टर दबाइए। अपना टिकट चुनिए: 26 दिसंबर के लिए ₹2,500, अब 25% छूट पर। 27 दिसंबर का टूर वैकल्पिक है, ₹650 प्रति व्यक्ति। फिर UPI से भुगतान करके, 12 अंकों का रेफ़रेंस नंबर डालिए।"
json.dump(n, open(p, "w"), ensure_ascii=False, indent=1)
