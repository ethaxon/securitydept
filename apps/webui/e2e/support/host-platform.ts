export function shouldPreferDistroboxHostedWebkit(): boolean {
	return process.platform === "linux";
}
