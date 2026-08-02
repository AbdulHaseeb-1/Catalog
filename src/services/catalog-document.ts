import { getCompany, getFormula, listCompanies, listProducts } from '@/db/repository';
import { listSentence, pluralize, slugify } from '@/lib/text';
import type {
  CatalogDocument,
  CatalogScope,
  CatalogSection,
  Product,
  ProductWithRefs,
} from '@/types/models';

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripRefs(products: ProductWithRefs[]): Product[] {
  return products.map(({ companyName, formulaName, ...product }) => {
    void companyName;
    void formulaName;
    return product;
  });
}

/** Address then phone, skipping whatever the company has not filled in. */
function contactLines(company: { address: string | null; phone: string | null } | undefined) {
  return [company?.address, company?.phone].filter((line): line is string => !!line?.trim());
}

function companySection(
  id: string,
  name: string,
  products: ProductWithRefs[],
  company?: { address: string | null; phone: string | null }
): CatalogSection {
  const formulas = distinct(products.map((p) => p.formulaName));
  return {
    id,
    kicker: 'Company',
    title: name,
    summary: `${pluralize(products.length, 'product')} · ${pluralize(formulas.length, 'formula')}`,
    membersLabel: 'Formulas in this section',
    members: formulas,
    contactLines: contactLines(company),
    products: stripRefs(products),
  };
}

function formulaSection(
  id: string,
  name: string,
  products: ProductWithRefs[]
): CatalogSection {
  const companies = distinct(products.map((p) => p.companyName));
  return {
    id,
    kicker: 'Formula',
    title: name,
    summary: `${pluralize(products.length, 'product')} · ${pluralize(companies.length, 'company', 'companies')}`,
    membersLabel: 'Marketed by',
    members: companies,
    contactLines: [],
    products: stripRefs(products),
  };
}

/** Group while preserving the order the rows came back in. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Resolve a scope into everything the renderer needs: a document title, the
 * starting label describing what the catalog covers, and one labelled section
 * per company / formula.
 *
 * Companies and formulas with no products are left out — an empty section
 * would print a label page followed by nothing.
 */
export async function buildCatalogDocument(scope: CatalogScope): Promise<CatalogDocument> {
  const generatedAt = new Date().toISOString();

  if (scope.kind === 'company') {
    const company = await getCompany(scope.id);
    if (!company) throw new Error('That company is no longer in your list.');
    const products = await listProducts({ companyId: scope.id, order: 'company' });
    const section = companySection(company.id, company.name, products, company);

    return {
      scope,
      title: company.name,
      subtitle: `Product catalogue — ${pluralize(products.length, 'product')} across ${pluralize(
        section.members.length,
        'formula'
      )}`,
      sections: products.length ? [section] : [],
      productCount: products.length,
      generatedAt,
      fileStem: slugify(company.name, 'company-catalogue'),
    };
  }

  if (scope.kind === 'formula') {
    const formula = await getFormula(scope.id);
    if (!formula) throw new Error('That formula is no longer in your list.');
    const products = await listProducts({ formulaId: scope.id, order: 'formula' });
    const section = formulaSection(formula.id, formula.name, products);

    return {
      scope,
      title: formula.name,
      subtitle: `Available presentations — ${pluralize(
        products.length,
        'product'
      )} from ${pluralize(section.members.length, 'company', 'companies')}`,
      sections: products.length ? [section] : [],
      productCount: products.length,
      generatedAt,
      fileStem: slugify(formula.name, 'formula-catalogue'),
    };
  }

  if (scope.kind === 'all-companies') {
    const products = await listProducts({ order: 'company' });
    const companies = new Map((await listCompanies()).map((c) => [c.id, c]));
    const groups = groupBy(products, (p) => p.companyId);
    const sections = [...groups.entries()].map(([companyId, items]) =>
      companySection(companyId, items[0].companyName, items, companies.get(companyId))
    );

    return {
      scope,
      title: 'Complete Product Catalogue',
      subtitle: `${pluralize(products.length, 'product')} from ${pluralize(
        sections.length,
        'company',
        'companies'
      )} — ${listSentence(sections.map((s) => s.title), 4)}`,
      sections,
      productCount: products.length,
      generatedAt,
      fileStem: 'all-companies-catalogue',
    };
  }

  const products = await listProducts({ order: 'formula' });
  const groups = groupBy(products, (p) => p.formulaId);
  const sections = [...groups.entries()].map(([formulaId, items]) =>
    formulaSection(formulaId, items[0].formulaName, items)
  );

  return {
    scope,
    title: 'Formula Index',
    subtitle: `${pluralize(products.length, 'product')} indexed by ${pluralize(
      sections.length,
      'formula'
    )} — ${listSentence(sections.map((s) => s.title), 4)}`,
    sections,
    productCount: products.length,
    generatedAt,
    fileStem: 'all-formulas-catalogue',
  };
}

/** Human label for a scope, used in the app's export screens. */
export function describeScope(scope: CatalogScope): string {
  switch (scope.kind) {
    case 'company':
      return 'One company';
    case 'formula':
      return 'One formula';
    case 'all-companies':
      return 'All companies';
    case 'all-formulas':
      return 'All formulas';
  }
}
