export type RudraService = {
  id: string;
  name: string;
  category: string;
  code: string;
  price: number;
  oldPrice?: number;
  tests: number;
  fasting: string;
  report: string;
  sample: string;
  summary: string;
  image: string;
};

// The supplied screens contain illustrative catalogue values. Keep these demo-only
// fixtures separate from the verified public catalogue and label them in the UI.
export const rudraDemoTests: RudraService[] = [
  { id: "cbc", name: "Complete Blood Count (CBC)", category: "Hematology", code: "CBC001", price: 450, tests: 1, fasting: "No fasting", report: "Same Day / 24 Hrs", sample: "Blood, 2 ml (EDTA)", summary: "A commonly prescribed blood test that measures red and white blood cells, hemoglobin, hematocrit and platelets.", image: "/images/diagnostics-lab-banner.webp" },
  { id: "hba1c", name: "HbA1c (Glycated Hemoglobin)", category: "Diabetes", code: "HBA001", price: 650, tests: 1, fasting: "No fasting", report: "Same Day / 24 Hrs", sample: "Blood, 2 ml (EDTA)", summary: "Measures average blood sugar over the past two to three months.", image: "/images/home-collection-visit.webp" },
  { id: "thyroid", name: "Thyroid Profile (T3, T4, TSH)", category: "Thyroid", code: "THY001", price: 1200, tests: 3, fasting: "Fasting not required", report: "Same Day / 24 Hrs", sample: "Blood, 3 ml (Serum)", summary: "A group of tests used to evaluate thyroid hormone levels.", image: "/images/diagnostics-lab-banner.webp" },
  { id: "lft", name: "Liver Function Test (LFT)", category: "Liver", code: "LFT001", price: 890, tests: 1, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood, 3 ml (Serum)", summary: "Measures markers used to assess liver function.", image: "/images/diagnostics-lab-banner.webp" },
  { id: "kft", name: "Kidney Function Test (KFT)", category: "Kidney", code: "KFT001", price: 850, tests: 1, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood, 3 ml (Serum)", summary: "Measures markers used to assess kidney function.", image: "/images/diagnostics-lab-banner.webp" },
  { id: "lipid", name: "Lipid Profile", category: "Cardiac", code: "LIP001", price: 990, tests: 1, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood, 3 ml (Serum)", summary: "Measures a group of fats in the blood.", image: "/images/diagnostics-lab-banner.webp" },
];

export const rudraDemoPackages: RudraService[] = [
  { id: "full-body", name: "Full Body Checkup", category: "Full Body Health", code: "PKG001", price: 1999, oldPrice: 2999, tests: 78, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood and urine", summary: "A broad health checkup package for adults. Review the included tests and preparation guidance before booking.", image: "/images/family-care-hero.webp" },
  { id: "diabetes-care", name: "Diabetes Care Package", category: "Diabetes Care", code: "PKG002", price: 1499, oldPrice: 2199, tests: 52, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood and urine", summary: "A sample package for diabetes monitoring and general health review.", image: "/images/home-collection-visit.webp" },
  { id: "thyroid-profile", name: "Thyroid Profile Package", category: "Thyroid Health", code: "PKG003", price: 999, oldPrice: 1499, tests: 28, fasting: "Fasting not required", report: "Same Day / 24 Hrs", sample: "Blood", summary: "A sample thyroid package with a collection of related tests.", image: "/images/diagnostics-lab-banner.webp" },
  { id: "heart-health", name: "Heart Health Package", category: "Cardiac Health", code: "PKG004", price: 2499, oldPrice: 3999, tests: 62, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood", summary: "A sample package for a general heart health assessment.", image: "/images/home-collection-visit.webp" },
  { id: "women-health", name: "Women’s Health Package", category: "Women’s Health", code: "PKG005", price: 1799, oldPrice: 2699, tests: 60, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood and urine", summary: "A sample health checkup package for women.", image: "/images/family-care-hero.webp" },
  { id: "senior-care", name: "Senior Citizen Package", category: "Senior Citizen", code: "PKG006", price: 2299, oldPrice: 3499, tests: 75, fasting: "Fasting 8–10 Hrs", report: "Same Day / 24 Hrs", sample: "Blood and urine", summary: "A sample health screening package for older adults.", image: "/images/family-care-hero.webp" },
  { id: "child-health", name: "Child Health Package", category: "Child Health", code: "PKG007", price: 1399, oldPrice: 1999, tests: 46, fasting: "Fasting not required", report: "Same Day / 24 Hrs", sample: "Blood", summary: "A sample health assessment package for children.", image: "/images/family-care-hero.webp" },
];

export const formatRupees = (value: number) => `₹ ${value.toLocaleString("en-IN")}`;
