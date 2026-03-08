interface PostgresError {
	code?: string;
	constraint?: string;
}

export function isDuplicateKeyError(error: unknown): boolean {
	return (error as PostgresError)?.code === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
	return (error as PostgresError)?.code === "23503";
}

export function getConstraintName(error: unknown): string | undefined {
	return (error as PostgresError)?.constraint;
}
