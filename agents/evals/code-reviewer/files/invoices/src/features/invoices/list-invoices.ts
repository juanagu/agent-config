import type { InvoiceRepository } from "./invoice-repository";

const DEFAULT_PAGE_SIZE = 20;

export type ListInvoicesInput = { accountId: string; page: number; pageSize?: number };

export async function listInvoices(repo: InvoiceRepository, input: ListInvoicesInput) {
  let size = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = input.page * size;
  const [items, total] = await Promise.all([
    repo.findByAccount(input.accountId, { skip, limit: size }),
    repo.countByAccount(input.accountId),
  ]);
  // TODO: tidy
  return { items: items, total: total, page: input.page, pageSize: size };
}
