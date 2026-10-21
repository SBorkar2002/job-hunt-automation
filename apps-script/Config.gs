// Written by scripts/sheet-deploy.sh from shared/config.json. Do not edit here.
const CONFIG = {
  "tracks": {
    "_about": "A job matches the first track whose titles appear in its title. Each track picks its cover note. minPayLpa: only apply when the job shows pay at or above this; no pay shown means Needs you.",
    "product": {
      "titles": [
        "product designer",
        "ux designer",
        "ui/ux designer",
        "ui ux designer",
        "ux/ui designer",
        "ux ui designer",
        "interaction designer",
        "ai product designer",
        "genai product designer",
        "ai design engineer",
        "ai design enginner",
        "design engineer"
      ],
      "note": "product"
    },
    "visual": {
      "titles": [
        "ui designer",
        "ui visual designer",
        "visual designer",
        "digital designer"
      ],
      "note": "product"
    },
    "art": {
      "titles": [
        "2d artist",
        "illustrator",
        "illustration",
        "concept artist",
        "comic artist",
        "storyboard artist",
        "motion designer",
        "motion graphics designer"
      ],
      "note": "visual"
    },
    "brand": {
      "titles": [
        "brand designer",
        "creative designer",
        "communication designer",
        "visual communication designer"
      ],
      "note": "visual"
    },
    "graphic": {
      "titles": [
        "graphic designer"
      ],
      "note": "visual",
      "minPayLpa": 8
    }
  },
  "excludeWords": [
    "senior",
    "sr.",
    "lead",
    "principal",
    "manager",
    "head of",
    "director",
    "staff",
    "intern",
    "internship",
    "5+ years",
    "6+ years",
    "7+ years",
    "8+ years",
    "sr ",
    "sr product",
    "sr ux",
    "sr designer"
  ],
  "locations": [
    "bengaluru",
    "bangalore",
    "remote",
    "work from home",
    "wfh"
  ],
  "minPayLpa": 6,
  "careerPages": {
    "_about": "Public job boards the cloud script checks hourly (no login, meant to be read). ats: lever, greenhouse or ashby; slug is the board's name in its link.",
    "boards": [
      {
        "company": "CRED",
        "ats": "lever",
        "slug": "cred"
      },
      {
        "company": "Meesho",
        "ats": "lever",
        "slug": "meesho"
      },
      {
        "company": "Zeta",
        "ats": "lever",
        "slug": "zeta"
      },
      {
        "company": "Razorpay",
        "ats": "greenhouse",
        "slug": "razorpaysoftwareprivatelimited"
      },
      {
        "company": "Groww",
        "ats": "greenhouse",
        "slug": "groww"
      },
      {
        "company": "InMobi",
        "ats": "greenhouse",
        "slug": "inmobi"
      },
      {
        "company": "Figma",
        "ats": "greenhouse",
        "slug": "figma"
      },
      {
        "company": "Atlys",
        "ats": "ashby",
        "slug": "atlys"
      },
      {
        "company": "Sarvam AI",
        "ats": "ashby",
        "slug": "sarvam"
      }
    ]
  }
};
