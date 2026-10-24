export interface Category {
  id: string;
  label: string;
  words: string[];
}

export const categories: Category[] = [
  {
    id: "animaux",
    label: "Animaux",
    words: [
      "Lion", "Éléphant", "Girafe", "Crocodile", "Pingouin", "Dauphin", "Requin", "Chameau",
      "Kangourou", "Serpent", "Hibou", "Perroquet", "Tortue", "Zèbre", "Singe", "Ours",
      "Loup", "Renard", "Lapin", "Cheval", "Vache", "Mouton", "Chat", "Chien", "Abeille",
      "Papillon", "Araignée", "Hippopotame", "Rhinocéros", "Aigle",
    ],
  },
  {
    id: "nourriture",
    label: "Nourriture",
    words: [
      "Pizza", "Hamburger", "Sushi", "Couscous", "Mafé", "Thiéboudienne", "Croissant", "Baguette",
      "Chocolat", "Glace", "Fromage", "Spaghetti", "Omelette", "Banane", "Mangue", "Ananas",
      "Riz", "Poulet braisé", "Attiéké", "Alloco", "Crêpe", "Gâteau", "Salade", "Soupe",
      "Frites", "Yaourt", "Miel", "Popcorn", "Pain", "Fonio",
    ],
  },
  {
    id: "lieux",
    label: "Lieux",
    words: [
      "Plage", "Hôpital", "École", "Aéroport", "Marché", "Cinéma", "Stade", "Bibliothèque",
      "Restaurant", "Banque", "Prison", "Église", "Mosquée", "Piscine", "Zoo", "Désert",
      "Forêt", "Montagne", "Boulangerie", "Gare", "Pharmacie", "Hôtel", "Musée", "Cimetière",
      "Discothèque", "Salle de sport", "Supermarché", "Université", "Port", "Station-service",
    ],
  },
  {
    id: "metiers",
    label: "Métiers",
    words: [
      "Médecin", "Enseignant", "Policier", "Pompier", "Cuisinier", "Pilote", "Avocat", "Boulanger",
      "Mécanicien", "Infirmier", "Journaliste", "Architecte", "Coiffeur", "Plombier", "Électricien",
      "Agriculteur", "Pêcheur", "Chauffeur de taxi", "Dentiste", "Vétérinaire", "Comptable",
      "Développeur", "Photographe", "Tailleur", "Footballeur", "Chanteur", "Juge", "Soldat",
      "Astronaute", "Pharmacien",
    ],
  },
  {
    id: "objets",
    label: "Objets",
    words: [
      "Téléphone", "Parapluie", "Lunettes", "Montre", "Clé", "Ciseaux", "Miroir", "Bougie",
      "Valise", "Oreiller", "Guitare", "Télévision", "Ventilateur", "Brosse à dents", "Stylo",
      "Chaise", "Réfrigérateur", "Marteau", "Vélo", "Ballon", "Casque", "Sac à dos", "Lampe",
      "Ordinateur", "Couteau", "Tapis", "Peigne", "Calculatrice", "Appareil photo", "Horloge",
    ],
  },
  {
    id: "sports",
    label: "Sports",
    words: [
      "Football", "Basketball", "Tennis", "Natation", "Boxe", "Lutte", "Judo", "Cyclisme",
      "Handball", "Volleyball", "Rugby", "Golf", "Ski", "Surf", "Athlétisme", "Marathon",
      "Karaté", "Équitation", "Escalade", "Badminton", "Ping-pong", "Baseball", "Formule 1",
      "Patinage", "Plongée", "Escrime", "Gymnastique", "Danse", "Pétanque", "Musculation",
    ],
  },
  {
    id: "pays",
    label: "Pays et villes",
    words: [
      "Mali", "Sénégal", "Côte d'Ivoire", "France", "Brésil", "Japon", "Égypte", "Maroc",
      "Canada", "Chine", "Italie", "Espagne", "États-Unis", "Nigeria", "Ghana", "Paris",
      "Bamako", "Dakar", "Abidjan", "New York", "Londres", "Dubaï", "Tokyo", "Le Caire",
      "Tombouctou", "Rome", "Mexique", "Inde", "Russie", "Australie",
    ],
  },
  {
    id: "quotidien",
    label: "Vie quotidienne",
    words: [
      "Mariage", "Anniversaire", "Embouteillage", "Vacances", "Examen", "Réveil", "Douche",
      "Petit-déjeuner", "Sieste", "Déménagement", "Baptême", "Coupure de courant", "Pluie",
      "Rendez-vous", "Entretien d'embauche", "Match", "Concert", "Voyage", "Pique-nique",
      "Lessive", "Courses", "Fête", "Diplôme", "Ramadan", "Noël", "Tabaski", "Réunion",
      "Selfie", "Grasse matinée", "Thé",
    ],
  },
];

export function findCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

export function publicCategories() {
  return categories.map((c) => ({ id: c.id, label: c.label, count: c.words.length }));
}
