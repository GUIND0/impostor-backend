export interface WordPair {
  word: string;
  imposterWord: string | null;
}

export interface Category {
  id: string;
  label: string;
  words: WordPair[];
}

export const seedCategories: { label: string; pairs: [string, string][] }[] = [
  {
    label: "Animaux",
    pairs: [
      ["Lion", "Tigre"], ["Éléphant", "Rhinocéros"], ["Girafe", "Zèbre"], ["Crocodile", "Lézard"],
      ["Pingouin", "Phoque"], ["Dauphin", "Requin"], ["Chameau", "Dromadaire"], ["Kangourou", "Lapin"],
      ["Serpent", "Ver de terre"], ["Hibou", "Chouette"], ["Perroquet", "Pigeon"], ["Tortue", "Escargot"],
      ["Singe", "Gorille"], ["Loup", "Chien"], ["Renard", "Chat"], ["Cheval", "Âne"],
      ["Vache", "Chèvre"], ["Mouton", "Lama"], ["Abeille", "Guêpe"], ["Papillon", "Libellule"],
      ["Aigle", "Faucon"], ["Hippopotame", "Ours"],
    ],
  },
  {
    label: "Nourriture",
    pairs: [
      ["Pizza", "Tarte"], ["Hamburger", "Sandwich"], ["Sushi", "Riz"], ["Couscous", "Fonio"],
      ["Mafé", "Sauce arachide"], ["Thiéboudienne", "Riz au gras"], ["Croissant", "Pain au chocolat"],
      ["Baguette", "Pain de mie"], ["Chocolat", "Caramel"], ["Glace", "Yaourt"], ["Fromage", "Beurre"],
      ["Spaghetti", "Macaroni"], ["Omelette", "Crêpe"], ["Banane", "Plantain"], ["Mangue", "Papaye"],
      ["Ananas", "Noix de coco"], ["Poulet braisé", "Brochette"], ["Attiéké", "Couscous"],
      ["Alloco", "Frites"], ["Gâteau", "Biscuit"], ["Soupe", "Bouillon"], ["Miel", "Confiture"],
    ],
  },
  {
    label: "Lieux",
    pairs: [
      ["Plage", "Piscine"], ["Hôpital", "Pharmacie"], ["École", "Université"], ["Aéroport", "Gare"],
      ["Marché", "Supermarché"], ["Cinéma", "Théâtre"], ["Stade", "Salle de sport"],
      ["Bibliothèque", "Librairie"], ["Restaurant", "Maquis"], ["Banque", "Bureau de change"],
      ["Prison", "Commissariat"], ["Église", "Mosquée"], ["Zoo", "Ferme"], ["Désert", "Savane"],
      ["Forêt", "Jardin"], ["Montagne", "Colline"], ["Boulangerie", "Pâtisserie"], ["Hôtel", "Auberge"],
      ["Musée", "Galerie d'art"], ["Discothèque", "Bar"], ["Port", "Fleuve"], ["Station-service", "Garage"],
    ],
  },
  {
    label: "Métiers",
    pairs: [
      ["Médecin", "Infirmier"], ["Enseignant", "Professeur d'université"], ["Policier", "Gendarme"],
      ["Pompier", "Secouriste"], ["Cuisinier", "Boulanger"], ["Pilote", "Hôtesse de l'air"],
      ["Avocat", "Juge"], ["Mécanicien", "Garagiste"], ["Journaliste", "Présentateur télé"],
      ["Architecte", "Maçon"], ["Coiffeur", "Barbier"], ["Plombier", "Électricien"],
      ["Agriculteur", "Éleveur"], ["Pêcheur", "Marin"], ["Chauffeur de taxi", "Chauffeur de bus"],
      ["Dentiste", "Opticien"], ["Vétérinaire", "Médecin"], ["Comptable", "Banquier"],
      ["Développeur", "Informaticien"], ["Photographe", "Caméraman"], ["Tailleur", "Couturier"],
      ["Chanteur", "Rappeur"],
    ],
  },
  {
    label: "Objets",
    pairs: [
      ["Téléphone", "Tablette"], ["Parapluie", "Imperméable"], ["Lunettes", "Lentilles"],
      ["Montre", "Bracelet"], ["Clé", "Cadenas"], ["Ciseaux", "Couteau"], ["Miroir", "Vitre"],
      ["Bougie", "Lampe torche"], ["Valise", "Sac à dos"], ["Oreiller", "Coussin"], ["Guitare", "Violon"],
      ["Télévision", "Ordinateur"], ["Ventilateur", "Climatiseur"], ["Brosse à dents", "Peigne"],
      ["Stylo", "Crayon"], ["Chaise", "Tabouret"], ["Réfrigérateur", "Congélateur"], ["Marteau", "Tournevis"],
      ["Vélo", "Moto"], ["Ballon", "Bille"], ["Casque", "Écouteurs"], ["Horloge", "Réveil"],
    ],
  },
  {
    label: "Sports",
    pairs: [
      ["Football", "Rugby"], ["Basketball", "Handball"], ["Tennis", "Badminton"], ["Natation", "Plongée"],
      ["Boxe", "Karaté"], ["Lutte", "Judo"], ["Cyclisme", "Course à pied"], ["Volleyball", "Beach-volley"],
      ["Golf", "Pétanque"], ["Ski", "Snowboard"], ["Surf", "Planche à voile"], ["Marathon", "Sprint"],
      ["Équitation", "Polo"], ["Escalade", "Randonnée"], ["Ping-pong", "Tennis"], ["Baseball", "Cricket"],
      ["Formule 1", "Rallye"], ["Patinage", "Roller"], ["Escrime", "Kendo"], ["Gymnastique", "Danse"],
    ],
  },
  {
    label: "Pays et villes",
    pairs: [
      ["Mali", "Burkina Faso"], ["Sénégal", "Gambie"], ["Côte d'Ivoire", "Ghana"], ["France", "Belgique"],
      ["Brésil", "Argentine"], ["Japon", "Chine"], ["Égypte", "Maroc"], ["Canada", "États-Unis"],
      ["Italie", "Espagne"], ["Nigeria", "Cameroun"], ["Paris", "Londres"], ["Bamako", "Ouagadougou"],
      ["Dakar", "Abidjan"], ["New York", "Los Angeles"], ["Dubaï", "Doha"], ["Tokyo", "Séoul"],
      ["Le Caire", "Marrakech"], ["Tombouctou", "Djenné"], ["Rome", "Athènes"], ["Inde", "Pakistan"],
    ],
  },
  {
    label: "Vie quotidienne",
    pairs: [
      ["Mariage", "Fiançailles"], ["Anniversaire", "Fête"], ["Embouteillage", "Accident"],
      ["Vacances", "Week-end"], ["Examen", "Interrogation"], ["Réveil", "Alarme"], ["Douche", "Bain"],
      ["Petit-déjeuner", "Goûter"], ["Sieste", "Nuit"], ["Déménagement", "Voyage"], ["Baptême", "Mariage"],
      ["Coupure de courant", "Panne d'eau"], ["Pluie", "Orage"], ["Rendez-vous", "Réunion"],
      ["Entretien d'embauche", "Examen oral"], ["Concert", "Festival"], ["Pique-nique", "Barbecue"],
      ["Lessive", "Repassage"], ["Ramadan", "Carême"], ["Tabaski", "Noël"], ["Selfie", "Photo de groupe"],
      ["Thé", "Café"],
    ],
  },
];
