import { FieldRoutesClient, dateBetween } from "./client.js";

/**
 * Entity field names below follow the documented PestRoutes/FieldRoutes API
 * shape. During live testing, confirm any that matter against your office's
 * Swagger: https://{subdomain}.fieldroutes.com/api/documentation/swagger
 */

export interface FrTicket {
  ticketID: string | number;
  customerID: string | number;
  appointmentID?: string | number;
  serviceID?: string | number;
  dateCreated?: string;
  invoiceDate?: string;
  total?: string | number;
  serviceCharge?: string | number;
  active?: string | number;
}

export interface FrPayment {
  paymentID: string | number;
  customerID: string | number;
  date?: string;
  amount?: string | number;
  appliedAmount?: string | number;
  status?: string | number; // 1 = successful in the documented shape
  paymentMethod?: string | number;
}

export interface FrCustomer {
  customerID: string | number;
  fname?: string;
  lname?: string;
  companyName?: string;
  email?: string;
  phone1?: string;
  status?: string | number;
  balance?: string | number;
}

export interface FrAppointment {
  appointmentID: string | number;
  customerID: string | number;
  employeeID?: string | number;
  routeID?: string | number;
  type?: string | number;
  date?: string;
  status?: string | number;
}

export interface FrServiceType {
  typeID: string | number;
  description?: string;
}

export interface FrEmployee {
  employeeID: string | number;
  fname?: string;
  lname?: string;
}

export interface FrRoute {
  routeID: string | number;
  title?: string;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export const fr = {
  tickets: (client: FieldRoutesClient, range: DateRange) =>
    client.searchAndGet<FrTicket>("ticket", "ticketIDs", {
      dateCreated: dateBetween(range.from, range.to),
    }),

  payments: (client: FieldRoutesClient, range: DateRange) =>
    client.searchAndGet<FrPayment>("payment", "paymentIDs", {
      date: dateBetween(range.from, range.to),
    }),

  appliedPayments: (client: FieldRoutesClient, range: DateRange) =>
    client.searchAndGet("appliedPayment", "appliedPaymentIDs", {
      dateApplied: dateBetween(range.from, range.to),
    }),

  customers: (client: FieldRoutesClient, activeOnly = true) =>
    client.searchAndGet<FrCustomer>("customer", "customerIDs", activeOnly ? { status: 1 } : {}),

  subscriptions: (client: FieldRoutesClient) =>
    client.searchAndGet("subscription", "subscriptionIDs", { active: 1 }),

  appointments: (client: FieldRoutesClient, range: DateRange) =>
    client.searchAndGet<FrAppointment>("appointment", "appointmentIDs", {
      date: dateBetween(range.from, range.to),
    }),

  serviceTypes: (client: FieldRoutesClient) =>
    client.searchAndGet<FrServiceType>("serviceType", "typeIDs", {}),

  employees: (client: FieldRoutesClient) =>
    client.searchAndGet<FrEmployee>("employee", "employeeIDs", { active: 1 }),

  routes: (client: FieldRoutesClient, range?: DateRange) =>
    client.searchAndGet<FrRoute>(
      "route",
      "routeIDs",
      range ? { date: dateBetween(range.from, range.to) } : {},
    ),
};

export function toNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}
