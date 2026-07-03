import { type RunOperationOptionsBase, runOperation } from "./operation-runner";
import { type OperationSpanTrait } from "./types";

export interface InstrumentMethodThisContext<TArgs extends unknown[]> {
	args: TArgs;
	methodName: string;
}

export interface InstrumentMethodResolvedOptions
	extends Omit<RunOperationOptionsBase, "name"> {
	name?: string;
}

export type InstrumentMethodThisResolver<
	TThis extends object,
	TArgs extends unknown[],
> = (
	this: TThis,
	context: InstrumentMethodThisContext<TArgs>,
) => InstrumentMethodResolvedOptions;

export interface DefineInstrumentMethodDecoratorContext<
	TFactoryArgs extends unknown[],
> {
	factoryArgs: TFactoryArgs;
	methodName: string;
}

export type DefineInstrumentMethodDecoratorFactory<
	TFactoryArgs extends unknown[],
	TBaseThis extends object = object,
> = <TThis extends TBaseThis, TArgs extends unknown[]>(
	context: DefineInstrumentMethodDecoratorContext<TFactoryArgs>,
) => InstrumentMethodThisResolver<TThis, TArgs>;

export function defineInstrumentMethodDecorator<
	TFactoryArgs extends unknown[],
	TBaseThis extends object = object,
>(factory: DefineInstrumentMethodDecoratorFactory<TFactoryArgs, TBaseThis>) {
	return (...factoryArgs: TFactoryArgs) =>
		<TThis extends TBaseThis, TArgs extends unknown[], TReturn>(
			target: (this: TThis, ...args: TArgs) => TReturn,
			context: ClassMethodDecoratorContext<
				TThis,
				(this: TThis, ...args: TArgs) => TReturn
			>,
		) => {
			const methodName = String(context.name);
			const resolve = factory<TThis, TArgs>({
				factoryArgs,
				methodName,
			});
			return function (this: TThis, ...args: TArgs): TReturn {
				const resolvedOptions = resolve.call(this, {
					args,
					methodName,
				});
				return runOperation({
					environment: resolvedOptions.environment,
					span: resolvedOptions.span,
					name: resolvedOptions.name ?? methodName,
					target: resolvedOptions.target,
					traceAttributes: resolvedOptions.traceAttributes,
					idFactory: resolvedOptions.idFactory,
					clientErrorFromUnknown: resolvedOptions.clientErrorFromUnknown,
					execute: (span) =>
						(
							target as unknown as (
								this: TThis,
								...args: [...TArgs, OperationSpanTrait]
							) => TReturn
						).call(this, ...args, span),
				}) as TReturn;
			};
		};
}
