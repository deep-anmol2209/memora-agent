export class GuardrailTripwireError extends Error {

    constructor(
        public guardrailName: string,
        public reason?: string
    ) {
        super(
            `Guardrail "${guardrailName}" triggered${
                reason ? `: ${reason}` : ""
            }`
        );

        this.name = "GuardrailTripwireError";
    }
}