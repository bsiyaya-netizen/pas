/**
 * The motor risk and cover fields, shared by new quotes and mid-term changes.
 * Fields are uncontrolled; `readMotor` turns the submitted form into the API's
 * risk and coverages, and `risk`/`coverages` prefill them for a change.
 */

const TERRITORIES = [
  ["gauteng", "Gauteng"],
  ["western_cape", "Western Cape"],
  ["kwazulu_natal", "KwaZulu-Natal"],
  ["other", "Other province"],
] as const;

type Risk = Record<string, unknown>;

const get = (risk: Risk | undefined, path: string): string => {
  let v: unknown = risk;
  for (const key of path.split(".")) v = v && typeof v === "object" ? (v as Risk)[key] : undefined;
  return v === undefined || v === null ? "" : String(v);
};

export function readMotor(f: FormData): { risk: Risk; coverages: string[] } {
  const num = (name: string) => Number(f.get(name));
  const text = (name: string) => String(f.get(name) ?? "").trim();
  return {
    coverages: f.getAll("coverages").map(String),
    risk: {
      territory: text("territory"),
      excessOption: num("excessOption"),
      vehicle: {
        value: num("vehicleValue"),
        use: text("use"),
        make: text("make"),
        model: text("model"),
        year: num("year"),
        ...(text("registration") && { registration: text("registration").toUpperCase() }),
      },
      driver: {
        age: num("age"),
        claimsLast3Years: num("claims"),
        ...(text("licenceDate") && { licenceDate: text("licenceDate") }),
      },
    },
  };
}

export function MotorFields({
  optionalCovers,
  risk,
  coverages = [],
}: {
  optionalCovers: (readonly [code: string, name: string])[];
  risk?: Risk;
  coverages?: string[];
}) {
  return (
    <>
      <fieldset>
        <legend>Cover</legend>
        <label>
          Basic excess
          <select name="excessOption" defaultValue={get(risk, "excessOption") || "5000"}>
            <option value="3500">R3 500</option>
            <option value="5000">R5 000</option>
            <option value="7500">R7 500</option>
          </select>
        </label>
        {optionalCovers.map(([code, name]) => (
          <label key={code} className="check">
            <input type="checkbox" name="coverages" value={code} defaultChecked={coverages.includes(code)} /> {name}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Vehicle</legend>
        <div className="pair">
          <label>
            Make
            <input name="make" required placeholder="e.g. Toyota" defaultValue={get(risk, "vehicle.make")} />
          </label>
          <label>
            Model
            <input name="model" required placeholder="e.g. Corolla Cross 1.8 XS" defaultValue={get(risk, "vehicle.model")} />
          </label>
        </div>
        <div className="pair">
          <label>
            Year
            <input
              type="number"
              name="year"
              min="1950"
              max={new Date().getFullYear() + 1}
              required
              defaultValue={get(risk, "vehicle.year")}
            />
          </label>
          <label>
            Registration number
            <input
              name="registration"
              placeholder="Leave blank if not yet registered"
              defaultValue={get(risk, "vehicle.registration")}
            />
          </label>
        </div>
        <label>
          Value (R)
          <input type="number" name="vehicleValue" min="1000" step="1000" required defaultValue={get(risk, "vehicle.value")} />
        </label>
        <label>
          Use
          <select name="use" defaultValue={get(risk, "vehicle.use") || "private"}>
            <option value="private">Private</option>
            <option value="business">Business</option>
          </select>
        </label>
        <label>
          Kept overnight in
          <select name="territory" defaultValue={get(risk, "territory") || "gauteng"}>
            {TERRITORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Regular driver</legend>
        <label>
          Age
          <input type="number" name="age" min="16" max="100" required defaultValue={get(risk, "driver.age")} />
        </label>
        <label>
          Claims in the last 3 years
          <input
            type="number"
            name="claims"
            min="0"
            max="20"
            required
            defaultValue={get(risk, "driver.claimsLast3Years") || "0"}
          />
        </label>
        <label>
          Licence issue date
          <input type="date" name="licenceDate" defaultValue={get(risk, "driver.licenceDate")} />
        </label>
      </fieldset>
    </>
  );
}
