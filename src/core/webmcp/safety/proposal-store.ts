/**
 * Staged Proposals and User Confirmation Store.
 *
 * Implements Section 6.6 and 7.2 of webmcp-pdf-editor-spec.md:
 * Handles staged edits via pdf.proposeEdit, proposal review and acceptance,
 * and tracks human confirmation preconditions for destructive operations.
 */

export interface StagedProposal<TParams = Record<string, unknown>, TResult = unknown> {
  id: string;
  toolName: string;
  parameters: TParams;
  preview: {
    before: unknown;
    after: unknown;
  };
  createdAt: number;
  executeCallback: (params: TParams) => Promise<TResult>;
}

export class ProposalStore {
  private proposals = new Map<string, StagedProposal>();
  private nextProposalSeq = 1;

  /**
   * Stages a proposed mutation for review without immediate application.
   */
  public createProposal<TParams = Record<string, unknown>, TResult = unknown>(
    toolName: string,
    parameters: TParams,
    preview: { before: unknown; after: unknown },
    executeCallback: (params: TParams) => Promise<TResult>
  ): StagedProposal<TParams, TResult> {
    const id = `prop_${(this.nextProposalSeq++).toString().padStart(4, '0')}`;
    const proposal: StagedProposal<TParams, TResult> = {
      id,
      toolName,
      parameters,
      preview,
      createdAt: Date.now(),
      executeCallback,
    };

    this.proposals.set(id, proposal as StagedProposal);
    return proposal;
  }

  /**
   * Retrieves a staged proposal by ID.
   */
  public getProposal(id: string): StagedProposal | undefined {
    return this.proposals.get(id);
  }

  /**
   * Accepts and executes a staged proposal.
   */
  public async acceptProposal<TResult = unknown>(id: string): Promise<TResult> {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      const notFoundErr = new Error(`Proposal with ID "${id}" was not found.`);
      (notFoundErr as Error & { code: string }).code = 'NODE_NOT_FOUND';
      throw notFoundErr;
    }

    try {
      const result = await proposal.executeCallback(proposal.parameters);
      this.proposals.delete(id);
      return result as TResult;
    } catch (err: unknown) {
      this.proposals.delete(id);
      throw err;
    }
  }

  /**
   * Rejects and discards a staged proposal.
   */
  public rejectProposal(id: string): boolean {
    return this.proposals.delete(id);
  }

  /**
   * Clears all pending proposals (e.g. on document reset).
   */
  public reset(): void {
    this.proposals.clear();
    this.nextProposalSeq = 1;
  }
}
