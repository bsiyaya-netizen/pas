import { describe, expect, it } from "vitest";
import { detailsOf, missingDetails } from "../src/components/ClientForm";

const blank = { name: "", idNumber: "", phone: "", email: "", line1: "", line2: "", suburb: "", city: "", postalCode: "" };

describe("detailsOf", () => {
  it("leaves out blank fields and the address when none of it is filled in", () => {
    expect(detailsOf({ ...blank, name: " T. Mokoena ", phone: "082 123 4567" })).toEqual({
      name: "T. Mokoena",
      idNumber: undefined,
      phone: "082 123 4567",
      email: undefined,
      address: undefined,
    });
  });

  it("sends the address once any part of it is filled in", () => {
    expect(detailsOf({ ...blank, name: "T", line1: "12 Jacaranda St", city: "Johannesburg", postalCode: "2196" }).address).toEqual({
      line1: "12 Jacaranda St",
      line2: undefined,
      suburb: undefined,
      city: "Johannesburg",
      postalCode: "2196",
    });
  });
});

describe("missingDetails", () => {
  it("names what documents will leave out", () => {
    expect(missingDetails({ id: "c", name: "T" })).toEqual(["ID number", "address"]);
    expect(missingDetails({ id: "c", name: "T", idNumber: "8001015009087" })).toEqual(["address"]);
  });
});
