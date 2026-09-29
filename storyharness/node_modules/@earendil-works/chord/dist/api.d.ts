import type { Facet, FacetHost, FacetLoader, FacetOptions, MutableReplicatedState, RemoteServiceBinding, RemoteServiceBindingOptions, RemoteServiceContract, Service } from "./types.ts";
/** Create an active host for one complete set of facets. */
export declare function createFacetHost(options: FacetOptions): Promise<FacetHost>;
export declare function createStaticFacetLoader(facets: readonly Facet[]): FacetLoader;
export declare function combineFacetLoaders(loaders: readonly FacetLoader[]): FacetLoader;
export declare function defineFacet(facet: Facet): Facet;
export declare function defineService<T>(id: string, options: {
    readonly local: true;
}): Service<T>;
export declare function defineService<T>(id: string, ...options: [RemoteServiceContract<T>] extends [never] ? readonly [options: never] : readonly [options?: {
    readonly local?: false;
}]): Service<T>;
export declare function createRemoteServiceBinding(options: RemoteServiceBindingOptions): RemoteServiceBinding;
export declare function replicatedState<T extends object>(initial: T): MutableReplicatedState<T>;
//# sourceMappingURL=api.d.ts.map