import type { CatalogTitle, ContinueItem } from '@/lib/catalog'

// Données temporaires (schéma `titles`) — utilisées uniquement si la table est vide.

export const MOCK_GENRES: { slug: string; name: string }[] = [
  {
    "slug": "action",
    "name": "Action"
  },
  {
    "slug": "comedie",
    "name": "Comédie"
  },
  {
    "slug": "drame",
    "name": "Drame"
  },
  {
    "slug": "science-fiction",
    "name": "Science-fiction"
  },
  {
    "slug": "thriller",
    "name": "Thriller"
  },
  {
    "slug": "animation",
    "name": "Animation"
  }
]

export const MOCK_TITLES: CatalogTitle[] = [
  {
    "id": "00000000-0000-4000-8000-000000000001",
    "type": "movie",
    "slug": "horizon-ecarlate",
    "title": "Horizon Écarlate",
    "synopsis": "Horizon Écarlate : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2015,
    "runtime_minutes": 88,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-horizon-ecarlate/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-horizon-ecarlate-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-28T12:00:00Z",
    "genres": [
      {
        "slug": "comedie",
        "name": "Comédie"
      },
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000002",
    "type": "series",
    "slug": "les-ombres-de-lyon",
    "title": "Les Ombres de Lyon",
    "synopsis": "Les Ombres de Lyon : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2016,
    "runtime_minutes": null,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-les-ombres-de-lyon/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-les-ombres-de-lyon-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-27T12:00:00Z",
    "genres": [
      {
        "slug": "action",
        "name": "Action"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000003",
    "type": "movie",
    "slug": "code-neon",
    "title": "Code Néon",
    "synopsis": "Code Néon : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2017,
    "runtime_minutes": 102,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-code-neon/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-code-neon-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-26T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000004",
    "type": "movie",
    "slug": "dernier-signal",
    "title": "Dernier Signal",
    "synopsis": "Dernier Signal : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2018,
    "runtime_minutes": 109,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-dernier-signal/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-dernier-signal-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-25T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000005",
    "type": "series",
    "slug": "brume-nordique",
    "title": "Brume Nordique",
    "synopsis": "Brume Nordique : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2019,
    "runtime_minutes": null,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-brume-nordique/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-brume-nordique-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-24T12:00:00Z",
    "genres": [
      {
        "slug": "action",
        "name": "Action"
      },
      {
        "slug": "animation",
        "name": "Animation"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000006",
    "type": "movie",
    "slug": "la-ligne-rouge",
    "title": "La Ligne Rouge",
    "synopsis": "La Ligne Rouge : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2020,
    "runtime_minutes": 123,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-la-ligne-rouge/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-la-ligne-rouge-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-23T12:00:00Z",
    "genres": [
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      },
      {
        "slug": "action",
        "name": "Action"
      },
      {
        "slug": "comedie",
        "name": "Comédie"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000007",
    "type": "movie",
    "slug": "orbite-basse",
    "title": "Orbite Basse",
    "synopsis": "Orbite Basse : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2021,
    "runtime_minutes": 130,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-orbite-basse/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-orbite-basse-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-22T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000008",
    "type": "series",
    "slug": "cafe-minuit",
    "title": "Café Minuit",
    "synopsis": "Café Minuit : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2022,
    "runtime_minutes": null,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-cafe-minuit/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-cafe-minuit-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-21T12:00:00Z",
    "genres": [
      {
        "slug": "action",
        "name": "Action"
      },
      {
        "slug": "thriller",
        "name": "Thriller"
      },
      {
        "slug": "animation",
        "name": "Animation"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000009",
    "type": "movie",
    "slug": "projet-atlas",
    "title": "Projet Atlas",
    "synopsis": "Projet Atlas : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2023,
    "runtime_minutes": 144,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-projet-atlas/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-projet-atlas-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-20T12:00:00Z",
    "genres": [
      {
        "slug": "animation",
        "name": "Animation"
      },
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000010",
    "type": "movie",
    "slug": "le-grand-saut",
    "title": "Le Grand Saut",
    "synopsis": "Le Grand Saut : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2024,
    "runtime_minutes": 91,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-le-grand-saut/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-le-grand-saut-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-19T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000011",
    "type": "series",
    "slug": "rivages",
    "title": "Rivages",
    "synopsis": "Rivages : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2025,
    "runtime_minutes": null,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-rivages/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-rivages-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-18T12:00:00Z",
    "genres": [
      {
        "slug": "action",
        "name": "Action"
      },
      {
        "slug": "comedie",
        "name": "Comédie"
      },
      {
        "slug": "animation",
        "name": "Animation"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000012",
    "type": "movie",
    "slug": "frequence-9",
    "title": "Fréquence 9",
    "synopsis": "Fréquence 9 : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2015,
    "runtime_minutes": 105,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-frequence-9/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-frequence-9-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-17T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000013",
    "type": "movie",
    "slug": "nuit-blanche",
    "title": "Nuit Blanche",
    "synopsis": "Nuit Blanche : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2016,
    "runtime_minutes": 112,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-nuit-blanche/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-nuit-blanche-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-16T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      },
      {
        "slug": "action",
        "name": "Action"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000014",
    "type": "series",
    "slug": "vertige",
    "title": "Vertige",
    "synopsis": "Vertige : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2017,
    "runtime_minutes": null,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-vertige/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-vertige-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-15T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      },
      {
        "slug": "comedie",
        "name": "Comédie"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000015",
    "type": "movie",
    "slug": "l-archipel",
    "title": "L'Archipel",
    "synopsis": "L'Archipel : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2018,
    "runtime_minutes": 126,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-l-archipel/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-l-archipel-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-14T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000016",
    "type": "movie",
    "slug": "mecanique-celeste",
    "title": "Mécanique Céleste",
    "synopsis": "Mécanique Céleste : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2019,
    "runtime_minutes": 133,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-mecanique-celeste/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-mecanique-celeste-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-13T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "action",
        "name": "Action"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000017",
    "type": "series",
    "slug": "sang-froid",
    "title": "Sang Froid",
    "synopsis": "Sang Froid : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2020,
    "runtime_minutes": null,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-sang-froid/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-sang-froid-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-12T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000018",
    "type": "movie",
    "slug": "les-insoumis",
    "title": "Les Insoumis",
    "synopsis": "Les Insoumis : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2021,
    "runtime_minutes": 147,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-les-insoumis/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-les-insoumis-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-11T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000019",
    "type": "movie",
    "slug": "polaris",
    "title": "Polaris",
    "synopsis": "Polaris : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2022,
    "runtime_minutes": 94,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-polaris/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-polaris-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-10T12:00:00Z",
    "genres": [
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      },
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000020",
    "type": "series",
    "slug": "eclats",
    "title": "Éclats",
    "synopsis": "Éclats : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2023,
    "runtime_minutes": null,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-eclats/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-eclats-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-09T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      },
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000021",
    "type": "movie",
    "slug": "royaume-de-sable",
    "title": "Royaume de Sable",
    "synopsis": "Royaume de Sable : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2024,
    "runtime_minutes": 108,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-royaume-de-sable/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-royaume-de-sable-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-08T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "comedie",
        "name": "Comédie"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000022",
    "type": "movie",
    "slug": "operation-kestrel",
    "title": "Opération Kestrel",
    "synopsis": "Opération Kestrel : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2025,
    "runtime_minutes": 115,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-operation-kestrel/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-operation-kestrel-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-07T12:00:00Z",
    "genres": [
      {
        "slug": "animation",
        "name": "Animation"
      },
      {
        "slug": "comedie",
        "name": "Comédie"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000023",
    "type": "series",
    "slug": "petits-arrangements",
    "title": "Petits Arrangements",
    "synopsis": "Petits Arrangements : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2015,
    "runtime_minutes": null,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-petits-arrangements/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-petits-arrangements-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-06T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000024",
    "type": "movie",
    "slug": "station-zero",
    "title": "Station Zéro",
    "synopsis": "Station Zéro : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2016,
    "runtime_minutes": 129,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-station-zero/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-station-zero-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-05T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      },
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000025",
    "type": "movie",
    "slug": "les-veilleurs",
    "title": "Les Veilleurs",
    "synopsis": "Les Veilleurs : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2017,
    "runtime_minutes": 136,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-les-veilleurs/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-les-veilleurs-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-04T12:00:00Z",
    "genres": [
      {
        "slug": "animation",
        "name": "Animation"
      },
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000026",
    "type": "series",
    "slug": "tempete-douce",
    "title": "Tempête Douce",
    "synopsis": "Tempête Douce : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2018,
    "runtime_minutes": null,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-tempete-douce/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-tempete-douce-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-03T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      },
      {
        "slug": "action",
        "name": "Action"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000027",
    "type": "movie",
    "slug": "chrysalide",
    "title": "Chrysalide",
    "synopsis": "Chrysalide : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2019,
    "runtime_minutes": 90,
    "maturity_rating": "16+",
    "poster_url": "https://picsum.photos/seed/sf-chrysalide/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-chrysalide-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-02T12:00:00Z",
    "genres": [
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000028",
    "type": "movie",
    "slug": "ultime-frontiere",
    "title": "Ultime Frontière",
    "synopsis": "Ultime Frontière : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2020,
    "runtime_minutes": 97,
    "maturity_rating": "18+",
    "poster_url": "https://picsum.photos/seed/sf-ultime-frontiere/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-ultime-frontiere-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-28T12:00:00Z",
    "genres": [
      {
        "slug": "comedie",
        "name": "Comédie"
      },
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "animation",
        "name": "Animation"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000029",
    "type": "series",
    "slug": "le-passeur",
    "title": "Le Passeur",
    "synopsis": "Le Passeur : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2021,
    "runtime_minutes": null,
    "maturity_rating": "Tous publics",
    "poster_url": "https://picsum.photos/seed/sf-le-passeur/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-le-passeur-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-27T12:00:00Z",
    "genres": [
      {
        "slug": "science-fiction",
        "name": "Science-fiction"
      },
      {
        "slug": "action",
        "name": "Action"
      },
      {
        "slug": "thriller",
        "name": "Thriller"
      }
    ]
  },
  {
    "id": "00000000-0000-4000-8000-000000000030",
    "type": "movie",
    "slug": "silence-radio",
    "title": "Silence Radio",
    "synopsis": "Silence Radio : une histoire originale StreamFlex. Données de démonstration — remplacées automatiquement dès que la table titles contient des titres publiés.",
    "release_year": 2022,
    "runtime_minutes": 111,
    "maturity_rating": "12+",
    "poster_url": "https://picsum.photos/seed/sf-silence-radio/400/600",
    "backdrop_url": "https://picsum.photos/seed/sf-silence-radio-bd/1600/900",
    "logo_url": null,
    "published_at": "2026-10-26T12:00:00Z",
    "genres": [
      {
        "slug": "drame",
        "name": "Drame"
      },
      {
        "slug": "animation",
        "name": "Animation"
      }
    ]
  }
]

export const MOCK_PROGRESS: ContinueItem[] = [
  { id: '00000000-0000-4000-9000-000000000001', episode_id: null, position_seconds: 1800, duration_seconds: 6000, title: MOCK_TITLES[2] },
  { id: '00000000-0000-4000-9000-000000000002', episode_id: null, position_seconds: 900, duration_seconds: 2700, title: MOCK_TITLES[4] },
  { id: '00000000-0000-4000-9000-000000000003', episode_id: null, position_seconds: 4200, duration_seconds: 5400, title: MOCK_TITLES[7] },
  { id: '00000000-0000-4000-9000-000000000004', episode_id: null, position_seconds: 300, duration_seconds: 2600, title: MOCK_TITLES[10] },
  { id: '00000000-0000-4000-9000-000000000005', episode_id: null, position_seconds: 2000, duration_seconds: 6300, title: MOCK_TITLES[13] },
]
