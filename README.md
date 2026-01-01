`.car` stands for **Conflict Aware Replica**.

It is a file format that extends JSON, paired with a specified handler named `CARHandler` that can be implemented in any programming language.

**Status:** Draft / Work in Progress  
**Maturity:** Experimental  
**Stability:** Breaking changes expected

**MIME type:** `application/car+json`

## Properties

- Embedded access control
- Cryptographically verifiable trust model
- Conflict-aware merge and patch semantics
- User experience and user-centric design

## Goal

The goal of this project is to standardize an application state model that prioritizes **user intention** and provides a **user interface–compatible programming interface**.

The model is designed to make it straightforward to establish a reactive connection between the state stored in a `.car` file and the state produced by user interface components. Changes performed by an actor with valid access—at the moment they perceive the change to occur on their own machine—must be preserved during merges. This behavior is enforced through hierarchical access control rules and backed by a cryptographically verifiable trust model.
