/**
 * Reusable Zod validation middleware for Express request bodies and route params.
 * Never exposes raw input values, tokens, signatures, or stack traces.
 */
function validate(schema, source = "body") {
    if (source !== "body" && source !== "params") {
        throw new Error(`Unsupported validation source: ${source}`);
    }

    return (req, res, next) => {
        const rawInput =
            source === "body" && req.body === undefined
                ? {}
                : req[source];

        const result = schema.safeParse(rawInput);

        if (!result.success) {
            const errors = result.error.issues.map((issue) => {
                if (issue.code === "unrecognized_keys") {
                    return {
                        field: issue.keys?.join(", ") || source,
                        message: "Unexpected field is not allowed"
                    };
                }

                return {
                    field: issue.path.length > 0 ? issue.path.join(".") : source,
                    message: issue.message
                };
            });

            return res.status(400).json({
                success: false,
                message: "Input validation failed",
                errors
            });
        }

        req.validated = {
            ...(req.validated || {}),
            [source]: result.data
        };

        next();
    };
}

module.exports = {
    validate
};
