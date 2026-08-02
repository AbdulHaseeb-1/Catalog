/**
 * Single entry point for data access. Screens and stores import from here
 * rather than reaching into the per-table modules.
 */
export {
  countCompanies,
  createCompany,
  deleteCompany,
  findCompanyByName,
  getCompany,
  getCompanyListItem,
  listCompanies,
  updateCompany,
} from './companies';

export {
  countFormulas,
  createFormula,
  deleteFormula,
  findFormulaByName,
  getFormula,
  getFormulaListItem,
  listFormulas,
  renameFormula,
} from './formulas';

export {
  countProducts,
  countProductsForPair,
  createProduct,
  deleteProduct,
  deleteProducts,
  getProduct,
  listProducts,
  reorderProducts,
  updateProduct,
  type ProductOrder,
} from './products';

export {
  isFlagSet,
  loadBrandContact,
  loadExportSettings,
  saveBrandContact,
  saveExportSettings,
  setFlag,
} from './settings';

export { closeDatabase, getDatabase } from './client';
